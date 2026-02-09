from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.middleware.auth import get_current_user, require_role
from app.models.models import Lab, SupportTicket, TicketReply, TicketStatus, User, UserRole
from app.schemas.schemas import (
    TicketCreate,
    TicketOut,
    TicketReplyCreate,
    TicketReplyOut,
    TicketUpdateStatus,
)
from app.services.email import notify_new_ticket, notify_ticket_reply

router = APIRouter(prefix="/api/tickets", tags=["tickets"])


def _ticket_to_out(ticket: SupportTicket) -> TicketOut:
    return TicketOut(
        id=ticket.id,
        lab_id=ticket.lab_id,
        user_id=ticket.user_id,
        user_name=ticket.creator.full_name,
        lab_name=ticket.lab.name,
        subject=ticket.subject,
        message=ticket.message,
        status=ticket.status,
        created_at=ticket.created_at,
        updated_at=ticket.updated_at,
        replies=[
            TicketReplyOut(
                id=r.id,
                ticket_id=r.ticket_id,
                user_id=r.user_id,
                user_name=r.author.full_name,
                message=r.message,
                created_at=r.created_at,
            )
            for r in ticket.replies
        ],
    )


@router.post("/", response_model=TicketOut)
def create_ticket(
    body: TicketCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR)
    ),
):
    if not current_user.lab_id and current_user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=400, detail="User has no lab")

    lab_id = current_user.lab_id
    if current_user.role == UserRole.SUPER_ADMIN and not lab_id:
        raise HTTPException(status_code=400, detail="Super admin must have a lab context to create tickets")

    ticket = SupportTicket(
        lab_id=lab_id,
        user_id=current_user.id,
        subject=body.subject.strip(),
        message=body.message.strip(),
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)

    if current_user.role != UserRole.SUPER_ADMIN:
        background_tasks.add_task(
            notify_new_ticket,
            ticket.lab.name,
            current_user.full_name,
            ticket.subject,
            ticket.message,
        )

    return _ticket_to_out(ticket)


@router.get("/", response_model=list[TicketOut])
def list_tickets(
    lab_id: UUID | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR)
    ),
):
    q = db.query(SupportTicket)

    if current_user.role == UserRole.SUPER_ADMIN:
        if lab_id:
            q = q.filter(SupportTicket.lab_id == lab_id)
    else:
        q = q.filter(SupportTicket.lab_id == current_user.lab_id)

    tickets = q.order_by(SupportTicket.created_at.desc()).all()
    return [_ticket_to_out(t) for t in tickets]


@router.get("/{ticket_id}", response_model=TicketOut)
def get_ticket(
    ticket_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR)
    ),
):
    q = db.query(SupportTicket).filter(SupportTicket.id == ticket_id)
    if current_user.role != UserRole.SUPER_ADMIN:
        q = q.filter(SupportTicket.lab_id == current_user.lab_id)
    ticket = q.first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return _ticket_to_out(ticket)


@router.post("/{ticket_id}/replies", response_model=TicketReplyOut)
def add_reply(
    ticket_id: UUID,
    body: TicketReplyCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR)
    ),
):
    q = db.query(SupportTicket).filter(SupportTicket.id == ticket_id)
    if current_user.role != UserRole.SUPER_ADMIN:
        q = q.filter(SupportTicket.lab_id == current_user.lab_id)
    ticket = q.first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    reply = TicketReply(
        ticket_id=ticket.id,
        user_id=current_user.id,
        message=body.message.strip(),
    )
    db.add(reply)
    db.commit()
    db.refresh(reply)

    if current_user.role != UserRole.SUPER_ADMIN:
        background_tasks.add_task(
            notify_ticket_reply,
            ticket.lab.name,
            current_user.full_name,
            ticket.subject,
            reply.message,
        )

    return TicketReplyOut(
        id=reply.id,
        ticket_id=reply.ticket_id,
        user_id=reply.user_id,
        user_name=current_user.full_name,
        message=reply.message,
        created_at=reply.created_at,
    )


@router.patch("/{ticket_id}/status", response_model=TicketOut)
def update_ticket_status(
    ticket_id: UUID,
    body: TicketUpdateStatus,
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR)
    ),
):
    q = db.query(SupportTicket).filter(SupportTicket.id == ticket_id)
    if current_user.role != UserRole.SUPER_ADMIN:
        q = q.filter(SupportTicket.lab_id == current_user.lab_id)
    ticket = q.first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    # Only super_admin can close/resolve; creator can reopen
    if body.status in (TicketStatus.RESOLVED, TicketStatus.CLOSED):
        if current_user.role != UserRole.SUPER_ADMIN:
            raise HTTPException(status_code=403, detail="Only platform admins can resolve or close tickets")

    ticket.status = body.status
    db.commit()
    db.refresh(ticket)
    return _ticket_to_out(ticket)
