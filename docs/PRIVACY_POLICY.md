# LabAid Privacy Policy

> **DRAFT -- This document has not been reviewed by legal counsel. It must be reviewed and approved by a qualified attorney before publication.**

**Effective Date:** [INSERT DATE]
**Last Updated:** [INSERT DATE]

---

## 1. Introduction

This Privacy Policy describes how LabAid ("we," "us," or "our") collects, uses, stores, and protects information when you use our web application and related services (collectively, the "Service"). LabAid is a software-as-a-service (SaaS) platform that helps Flow Cytometry laboratories manage antibody inventory, lot tracking, and quality control documentation.

By using the Service, you agree to the collection and use of information as described in this policy. If you do not agree, please do not use the Service.

---

## 2. Information We Collect

### 2.1 Account Information

When your lab administrator creates an account for you or you complete an invitation, we collect:

- **Full name** -- used to identify you within your lab's workspace.
- **Email address** -- used for authentication, password resets, and account invitations.
- **Password** -- stored only as a one-way bcrypt hash. We never store or have access to your plaintext password.
- **Role** -- your assigned role within the lab (e.g., technician, supervisor, lab administrator), used to determine your access permissions.

### 2.2 Lab and Inventory Data

When you and your team use the Service, we store data that you provide, including:

- Lab name and configuration settings.
- Antibody catalog records.
- Lot numbers, vial tracking data, and storage locations.
- QC status and related documentation (uploaded files).

### 2.3 Audit Logs

All data modifications within the Service are recorded in an immutable audit log. Each log entry includes:

- The user ID of the person who performed the action.
- The type of action performed.
- A timestamp of when the action occurred.
- The state of the affected record before and after the change.

Audit logs exist to maintain data integrity and traceability, which is essential for laboratory quality management.

### 2.4 Technical Data

- **IP addresses** -- used transiently for rate limiting on authentication endpoints. IP addresses are not stored in our database or logs.
- **Authentication cookies** -- a single HttpOnly cookie is used to maintain your authenticated session (see Section 5).

### 2.5 Information We Do NOT Collect

- We do not collect patient data or protected health information (PHI). LabAid is a laboratory inventory management tool, not a clinical or patient-facing system.
- We do not use analytics services or advertising trackers.
- We do not collect browsing behavior, device fingerprints, or location data.
- We do not integrate with social media platforms.

---

## 3. How We Use Your Information

We use the information we collect for the following purposes:

- **Providing the Service** -- to operate the application, authenticate users, enforce role-based access controls, and deliver the features you and your lab rely on.
- **Account management** -- to send invitation emails and password reset links when requested.
- **Data integrity** -- to maintain audit logs that record who changed what and when, supporting laboratory quality and compliance requirements.
- **Security** -- to enforce rate limiting on login attempts and protect accounts from unauthorized access.
- **Service maintenance** -- to perform database backups, monitor system health, and ensure the Service remains available and reliable.

We do not sell, rent, or share your personal information with third parties for marketing or advertising purposes.

---

## 4. Data Storage and Security

### 4.1 Hosting and Infrastructure

All data is hosted on Google Cloud Platform (GCP) in the **US-CENTRAL1** region. Our infrastructure includes:

- **Google Cloud Run** for application compute.
- **Google Cloud SQL** for the PostgreSQL database.
- **Firebase Hosting** for the frontend web application.
- **Google Cloud Storage (GCS)** for uploaded documents.

All data processing occurs within the United States. We do not transfer data internationally.

### 4.2 Security Measures

We implement the following security measures to protect your data:

- **Encryption at rest** -- all data stored in Cloud SQL, Cloud Storage, and backups is encrypted at rest using GCP's default encryption.
- **Encryption in transit** -- all data transmitted between your browser and our servers is encrypted using TLS (HTTPS).
- **Password hashing** -- passwords are hashed using bcrypt before storage. Plaintext passwords are never stored or logged.
- **Role-based access control** -- users can only access data and perform actions permitted by their assigned role.
- **Multi-tenant isolation** -- each lab's data is isolated at the database query level. Every query is scoped to the authenticated user's lab, preventing cross-lab data access.
- **Rate limiting** -- authentication endpoints are rate-limited to protect against brute-force attacks.
- **Audit logging** -- all data mutations are logged in an immutable, append-only audit log.

### 4.3 Database Backups

- Automated daily backups are performed on the database.
- Point-in-time recovery is available for a rolling 7-day window.

---

## 5. Cookies

LabAid uses a **single cookie** for authentication:

| Cookie Name | Purpose | Type | Duration |
|---|---|---|---|
| `__session` | Stores your authentication token (JWT) to keep you signed in. | HttpOnly, Secure | Duration of your session |

This cookie is an **HttpOnly** cookie, which means it cannot be accessed by JavaScript running in your browser, providing protection against cross-site scripting (XSS) attacks.

**We do not use:**
- Tracking cookies.
- Third-party cookies.
- Advertising cookies.
- Analytics cookies.

Because we use only a single, strictly necessary authentication cookie, no cookie consent banner is required under most jurisdictions. The cookie is essential for the Service to function.

---

## 6. Third-Party Services

We use a limited number of third-party services to operate LabAid:

| Service | Purpose | Data Shared |
|---|---|---|
| **Google Cloud Platform** | Hosting, database, file storage, and infrastructure. | All Service data is stored on GCP infrastructure. |
| **Resend** | Transactional email delivery. | Email addresses of recipients, for the sole purpose of delivering account invitation and password reset emails. |

We do not use any third-party analytics, advertising, or social media services.

---

## 7. Data Retention

### 7.1 Active Accounts

For active lab accounts, all data (account information, inventory data, QC documents, and audit logs) is retained for the duration of the account's active use of the Service.

### 7.2 Suspended Accounts

If a lab account is suspended (e.g., due to billing), the account enters a read-only state. All data is preserved and remains accessible in read-only mode.

### 7.3 Audit Logs

Audit logs are immutable and are never deleted, even upon account deletion. This is necessary to maintain data integrity and traceability for laboratory quality management purposes.

### 7.4 Document Storage

- Uploaded documents are stored with versioning enabled.
- After 365 days, documents are automatically transitioned to a lower-cost storage class (Nearline) but remain accessible.
- Deleted documents are retained in a soft-delete state for 7 days before permanent removal.

---

## 8. Data Deletion

### 8.1 Account Deletion Requests

Lab administrators may request deletion of their lab's account and associated data by contacting us at [CONTACT_EMAIL]. Upon receiving a verified deletion request, we will:

1. Delete all account information (names, email addresses, hashed passwords).
2. Delete all lab inventory data (antibodies, lots, vials, storage configurations).
3. Delete all uploaded QC documents.
4. **Retain audit logs** -- audit log entries will be retained in anonymized form to preserve data integrity. User-identifying information within audit logs will be disassociated where technically feasible.

We will process deletion requests within 30 days of verification.

### 8.2 Individual User Removal

Lab administrators can deactivate individual user accounts through the Service. Deactivated users can no longer sign in or access the Service. Audit log entries associated with deactivated users are retained.

---

## 9. Your Rights

Depending on your jurisdiction, you may have the following rights regarding your personal data:

- **Access** -- request a copy of the personal data we hold about you.
- **Correction** -- request correction of inaccurate personal data.
- **Deletion** -- request deletion of your personal data (subject to the audit log retention described in Section 8).
- **Data portability** -- request an export of your data in a portable format.

To exercise any of these rights, contact us at [CONTACT_EMAIL]. We will respond within 30 days.

---

## 10. Children's Privacy

LabAid is a professional laboratory management tool intended for use by adults in a professional workplace setting. We do not knowingly collect personal information from anyone under the age of 16. If we become aware that we have collected personal information from a child under 16, we will take steps to delete that information promptly. If you believe a child under 16 has provided us with personal information, please contact us at [CONTACT_EMAIL].

---

## 11. HIPAA Disclaimer

LabAid is a laboratory inventory and quality control management tool. It is **not** designed to process, store, or transmit protected health information (PHI) as defined by the Health Insurance Portability and Accountability Act (HIPAA). LabAid tracks antibody inventory, lot numbers, vial status, and QC documentation -- none of which constitute PHI. Users should not enter patient data or any information that could identify a patient into the Service.

---

## 12. Changes to This Privacy Policy

We may update this Privacy Policy from time to time. When we make changes:

- We will update the "Last Updated" date at the top of this document.
- For material changes, we will notify lab administrators via email.
- Continued use of the Service after changes take effect constitutes acceptance of the updated policy.

We encourage you to review this policy periodically.

---

## 13. Contact Us

If you have questions, concerns, or requests related to this Privacy Policy or your personal data, please contact us at:

**Email:** [CONTACT_EMAIL]

---

> **DRAFT -- This document requires review and approval by qualified legal counsel before being published or relied upon.**
