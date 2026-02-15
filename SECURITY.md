# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in LabAid, please report it responsibly.

**Email**: [CONTACT_EMAIL]

Please include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

## Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 5 business days
- **Fix for critical issues**: As soon as possible, typically within 7 days

## Scope

The following are in scope:
- Authentication and authorization bypasses
- Data leakage between tenants (lab isolation)
- SQL injection, XSS, CSRF
- Insecure direct object references
- Privilege escalation

The following are out of scope:
- Denial of service attacks
- Social engineering
- Issues in third-party dependencies (report upstream)
- Issues requiring physical access

## Security Measures

- All data encrypted in transit (TLS) and at rest (GCP default encryption)
- Passwords hashed with bcrypt
- JWT authentication via HttpOnly cookies with SameSite protection
- Role-based access control with lab-level tenant isolation
- Rate limiting on authentication endpoints
- Immutable, append-only audit log
- Automated daily database backups with 7-day point-in-time recovery

## Acknowledgments

We appreciate responsible disclosure and will credit reporters (with permission) once a fix is released.
