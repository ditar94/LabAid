import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.core.config import settings

logger = logging.getLogger(__name__)


def _is_configured() -> bool:
    return bool(settings.SMTP_HOST and settings.SMTP_FROM and settings.ADMIN_EMAIL)


def _send(subject: str, html_body: str) -> None:
    if not _is_configured():
        return
    msg = MIMEMultipart("alternative")
    msg["From"] = settings.SMTP_FROM
    msg["To"] = settings.ADMIN_EMAIL
    msg["Subject"] = subject
    msg.attach(MIMEText(html_body, "html"))
    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as server:
            server.starttls()
            if settings.SMTP_USER and settings.SMTP_PASSWORD:
                server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            server.sendmail(settings.SMTP_FROM, settings.ADMIN_EMAIL, msg.as_string())
    except Exception:
        logger.exception("Failed to send email: %s", subject)


def notify_new_ticket(lab_name: str, user_name: str, subject: str, message: str) -> None:
    _send(
        f"[LabAid] New ticket from {lab_name}: {subject}",
        f"<h3>New Support Ticket</h3>"
        f"<p><strong>Lab:</strong> {lab_name}<br>"
        f"<strong>From:</strong> {user_name}<br>"
        f"<strong>Subject:</strong> {subject}</p>"
        f"<p>{message}</p>",
    )


def notify_ticket_reply(
    lab_name: str, user_name: str, ticket_subject: str, reply_message: str
) -> None:
    _send(
        f"[LabAid] Reply on ticket: {ticket_subject}",
        f"<h3>New Reply on Ticket</h3>"
        f"<p><strong>Lab:</strong> {lab_name}<br>"
        f"<strong>From:</strong> {user_name}<br>"
        f"<strong>Ticket:</strong> {ticket_subject}</p>"
        f"<p>{reply_message}</p>",
    )
