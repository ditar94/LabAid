import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from urllib.parse import quote

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


# ── Invite / Reset Email Backend ──────────────────────────────────────────


def _build_link(token: str) -> str:
    return f"{settings.APP_URL}/set-password?token={quote(token, safe='')}"


def _invite_html(full_name: str, link: str) -> str:
    return (
        '<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">'
        f"<h2>Welcome to LabAid, {full_name}!</h2>"
        "<p>Your administrator has created an account for you. "
        "Click the button below to set your password and get started.</p>"
        f'<p style="text-align:center;margin:32px 0">'
        f'<a href="{link}" style="background:#2563eb;color:#fff;padding:12px 28px;'
        'border-radius:6px;text-decoration:none;font-weight:600">Set Your Password</a></p>'
        "<p style=\"color:#666;font-size:13px\">This link expires in 24 hours. "
        "If you didn't expect this email, you can safely ignore it.</p>"
        "</div>"
    )


def _reset_html(full_name: str, link: str) -> str:
    return (
        '<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">'
        f"<h2>Reset Your Password</h2>"
        f"<p>Hi {full_name}, your administrator has reset your password. "
        "Click the button below to set a new one.</p>"
        f'<p style="text-align:center;margin:32px 0">'
        f'<a href="{link}" style="background:#2563eb;color:#fff;padding:12px 28px;'
        'border-radius:6px;text-decoration:none;font-weight:600">Set New Password</a></p>'
        "<p style=\"color:#666;font-size:13px\">This link expires in 24 hours. "
        "If you didn't request this, contact your administrator.</p>"
        "</div>"
    )


def _send_via_resend(to: str, subject: str, html_body: str) -> bool:
    import sys
    try:
        import resend
        resend.api_key = settings.RESEND_API_KEY
        result = resend.Emails.send({
            "from": "LabAid <noreply@labaid.io>",
            "to": [to],
            "subject": subject,
            "html": html_body,
        })
        print(f"[EMAIL] Resend OK to={to} id={getattr(result, 'id', result)}", file=sys.stderr, flush=True)
        return True
    except Exception as exc:
        print(f"[EMAIL] Resend FAILED to={to} error={type(exc).__name__}: {exc}", file=sys.stderr, flush=True)
        return False


def _send_via_console(to: str, subject: str, html_body: str) -> bool:
    logger.info("=== EMAIL (console backend) ===")
    logger.info("To: %s | Subject: %s", to, subject)
    return True


def _send_invite_or_reset(to: str, subject: str, html_body: str) -> bool:
    if settings.EMAIL_BACKEND == "resend":
        return _send_via_resend(to, subject, html_body)
    return _send_via_console(to, subject, html_body)


def send_invite_email(to: str, full_name: str, token: str) -> tuple[bool, str]:
    link = _build_link(token)
    html = _invite_html(full_name, link)
    success = _send_invite_or_reset(to, "Welcome to LabAid — Set Your Password", html)
    return success, link


def send_reset_email(to: str, full_name: str, token: str) -> tuple[bool, str]:
    link = _build_link(token)
    html = _reset_html(full_name, link)
    success = _send_invite_or_reset(to, "LabAid — Reset Your Password", html)
    return success, link


def _forgot_password_html(full_name: str, link: str) -> str:
    return (
        '<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">'
        f"<h2>Reset Your Password</h2>"
        f"<p>Hi {full_name}, you requested a password reset. "
        "Click the button below to set a new password.</p>"
        f'<p style="text-align:center;margin:32px 0">'
        f'<a href="{link}" style="background:#2563eb;color:#fff;padding:12px 28px;'
        'border-radius:6px;text-decoration:none;font-weight:600">Set New Password</a></p>'
        "<p style=\"color:#666;font-size:13px\">This link expires in 24 hours. "
        "If you didn't request this, you can safely ignore this email.</p>"
        "</div>"
    )


def send_forgot_password_email(to: str, full_name: str, token: str) -> tuple[bool, str]:
    link = _build_link(token)
    html = _forgot_password_html(full_name, link)
    success = _send_invite_or_reset(to, "LabAid — Reset Your Password", html)
    if settings.EMAIL_BACKEND == "console":
        import sys
        print(f"[EMAIL] Forgot password link for {to}: {link}", file=sys.stderr, flush=True)
    return success, link
