export default function PrivacyContent() {
  return (
    <>
      <section>
        <h2>1. Introduction</h2>
        <p>
          This Privacy Policy describes how LabWorx LLC ("we," "us," or "our") collects, uses,
          stores, and protects information when you use the LabAid platform and related services
          (collectively, the "Service"). LabAid is a software-as-a-service (SaaS) platform developed
          and operated by LabWorx LLC that helps flow cytometry laboratories manage antibody
          inventory, lot tracking, and quality control documentation.
        </p>
        <p>
          By using the Service, you agree to the collection and use of information as described in
          this policy. If you do not agree, please do not use the Service.
        </p>
      </section>

      <section>
        <h2>2. Information We Collect</h2>

        <h3>2.1 Account Information</h3>
        <p>
          When your lab administrator creates an account for you or you complete an invitation, we
          collect:
        </p>
        <ul>
          <li>
            <strong>Full name</strong> — used to identify you within your lab's workspace.
          </li>
          <li>
            <strong>Email address</strong> — used for authentication, password resets, and account
            invitations.
          </li>
          <li>
            <strong>Password</strong> — stored only as a one-way bcrypt hash. We never store or have
            access to your plaintext password.
          </li>
          <li>
            <strong>Role</strong> — your assigned role within the lab (e.g., technician, supervisor,
            lab administrator), used to determine your access permissions.
          </li>
        </ul>

        <h3>2.2 Lab and Inventory Data</h3>
        <p>When you and your team use the Service, we store data that you provide, including:</p>
        <ul>
          <li>Lab name and configuration settings.</li>
          <li>Antibody catalog records.</li>
          <li>Lot numbers, vial tracking data, and storage locations.</li>
          <li>QC status and related documentation (uploaded files).</li>
        </ul>

        <h3>2.3 Audit Logs</h3>
        <p>
          All data modifications within the Service are recorded in an immutable audit log. Each log
          entry includes:
        </p>
        <ul>
          <li>The user ID of the person who performed the action.</li>
          <li>The type of action performed.</li>
          <li>A timestamp of when the action occurred.</li>
          <li>The state of the affected record before and after the change.</li>
        </ul>
        <p>
          Audit logs exist to maintain data integrity and traceability, which is essential for
          laboratory quality management.
        </p>

        <h3>2.4 Technical Data</h3>
        <ul>
          <li>
            <strong>IP addresses</strong> — used transiently for rate limiting on authentication
            endpoints. IP addresses are not stored in our database or logs.
          </li>
          <li>
            <strong>Authentication cookies</strong> — a single HttpOnly cookie is used to maintain
            your authenticated session (see Section 5).
          </li>
        </ul>

        <h3>2.5 Information We Do NOT Collect</h3>
        <ul>
          <li>
            We do not collect patient data or protected health information (PHI). LabAid is a
            laboratory inventory management tool, not a clinical or patient-facing system.
          </li>
          <li>We do not use analytics services or advertising trackers.</li>
          <li>
            We do not collect browsing behavior, device fingerprints, or location data.
          </li>
          <li>We do not integrate with social media platforms.</li>
        </ul>
      </section>

      <section>
        <h2>3. How We Use Your Information</h2>
        <p>We use the information we collect for the following purposes:</p>
        <ul>
          <li>
            <strong>Providing the Service</strong> — to operate the application, authenticate users,
            enforce role-based access controls, and deliver the features you and your lab rely on.
          </li>
          <li>
            <strong>Account management</strong> — to send invitation emails and password reset links
            when requested.
          </li>
          <li>
            <strong>Data integrity</strong> — to maintain audit logs that record who changed what and
            when, supporting laboratory quality and compliance requirements.
          </li>
          <li>
            <strong>Security</strong> — to enforce rate limiting on login attempts and protect
            accounts from unauthorized access.
          </li>
          <li>
            <strong>Service maintenance</strong> — to perform database backups, monitor system
            health, and ensure the Service remains available and reliable.
          </li>
        </ul>
        <p>
          We do not sell, rent, or share your personal information with third parties for marketing
          or advertising purposes.
        </p>
      </section>

      <section>
        <h2>4. Data Storage and Security</h2>

        <h3>4.1 Hosting and Infrastructure</h3>
        <p>
          All data is hosted on Google Cloud Platform (GCP) in the US-CENTRAL1 region. Our
          infrastructure includes:
        </p>
        <ul>
          <li>Google Cloud Run for application compute.</li>
          <li>Google Cloud SQL for the PostgreSQL database.</li>
          <li>Google Cloud Storage (GCS) for uploaded documents.</li>
        </ul>
        <p>
          All data processing occurs within the United States. We do not transfer data
          internationally.
        </p>

        <h3>4.2 Security Measures</h3>
        <p>We implement the following security measures to protect your data:</p>
        <ul>
          <li>
            <strong>Encryption at rest</strong> — all data stored in Cloud SQL, Cloud Storage, and
            backups is encrypted at rest using GCP's default encryption.
          </li>
          <li>
            <strong>Encryption in transit</strong> — all data transmitted between your browser and
            our servers is encrypted using TLS (HTTPS).
          </li>
          <li>
            <strong>Password hashing</strong> — passwords are hashed using bcrypt before storage.
            Plaintext passwords are never stored or logged.
          </li>
          <li>
            <strong>Role-based access control</strong> — users can only access data and perform
            actions permitted by their assigned role.
          </li>
          <li>
            <strong>Multi-tenant isolation</strong> — each lab's data is isolated at the database
            query level. Every query is scoped to the authenticated user's lab, preventing cross-lab
            data access.
          </li>
          <li>
            <strong>Rate limiting</strong> — authentication endpoints are rate-limited to protect
            against brute-force attacks.
          </li>
          <li>
            <strong>Audit logging</strong> — all data mutations are logged in an immutable,
            append-only audit log.
          </li>
        </ul>

        <h3>4.3 Database Backups</h3>
        <ul>
          <li>Automated daily backups are performed on the database.</li>
          <li>Point-in-time recovery is available for a rolling 7-day window.</li>
        </ul>
      </section>

      <section>
        <h2>5. Cookies</h2>
        <p>LabAid uses a single cookie for authentication:</p>
        <ul>
          <li>
            <strong>__session</strong> — stores your authentication token (JWT) to keep you signed
            in. This cookie is HttpOnly (cannot be accessed by JavaScript, protecting against XSS
            attacks), Secure (transmitted only over HTTPS), and SameSite=Lax (providing CSRF
            protection).
          </li>
        </ul>
        <p>
          <strong>We do not use</strong> tracking cookies, third-party cookies, advertising cookies,
          or analytics cookies.
        </p>
        <p>
          Because we use only a single, strictly necessary authentication cookie, no cookie consent
          banner is required under most jurisdictions.
        </p>
      </section>

      <section>
        <h2>6. Third-Party Services</h2>
        <p>We use a limited number of third-party services to operate LabAid:</p>
        <ul>
          <li>
            <strong>Google Cloud Platform</strong> — hosting, database, file storage, and
            infrastructure. All Service data is stored on GCP infrastructure.
          </li>
          <li>
            <strong>Stripe</strong> — payment processing for subscriptions and billing. Stripe
            receives billing-related information (name, email, payment method) necessary to process
            payments. Stripe's use of your data is governed by{" "}
            <a href="https://stripe.com/privacy" target="_blank" rel="noopener noreferrer">
              Stripe's Privacy Policy
            </a>
            .
          </li>
          <li>
            <strong>Resend</strong> — transactional email delivery. Email addresses of recipients are
            shared for the sole purpose of delivering account invitation and password reset emails.
          </li>
        </ul>
        <p>
          We do not use any third-party analytics, advertising, or social media services.
        </p>
      </section>

      <section>
        <h2>7. Data Retention</h2>
        <p>
          For active lab accounts, all data (account information, inventory data, QC documents, and
          audit logs) is retained for the duration of the account's active use of the Service.
        </p>
        <p>
          If a lab account is suspended (e.g., due to billing), the account enters a read-only state.
          All data is preserved and remains accessible in read-only mode.
        </p>
        <p>
          If a lab account remains cancelled or inactive for more than one year, we reserve the right
          to delete all associated account data, inventory records, and uploaded documents. We will
          make reasonable efforts to notify the lab administrator via email before deletion.
        </p>
        <p>
          Audit logs are immutable and are retained even after account deletion in anonymized form.
          This is necessary to maintain data integrity and traceability for laboratory quality
          management purposes.
        </p>
        <p>
          Uploaded documents are stored with versioning enabled. Deleted documents are retained in a
          soft-delete state for 7 days before permanent removal.
        </p>
      </section>

      <section>
        <h2>8. Data Deletion</h2>
        <p>
          Lab administrators may request deletion of their lab's account and associated data by
          contacting us at{" "}
          <a href="mailto:support@labaid.io">support@labaid.io</a>. Upon receiving a verified
          deletion request, we will:
        </p>
        <ul>
          <li>Delete all account information (names, email addresses, hashed passwords).</li>
          <li>Delete all lab inventory data (antibodies, lots, vials, storage configurations).</li>
          <li>Delete all uploaded QC documents.</li>
          <li>
            <strong>Retain audit logs</strong> — audit log entries will be retained in anonymized
            form to preserve data integrity.
          </li>
        </ul>
        <p>We will process deletion requests within 30 days of verification.</p>
        <p>
          Lab administrators can deactivate individual user accounts through the Service. Deactivated
          users can no longer sign in or access the Service. Audit log entries associated with
          deactivated users are retained.
        </p>
      </section>

      <section>
        <h2>9. Your Rights</h2>
        <p>
          Depending on your jurisdiction, you may have the following rights regarding your personal
          data:
        </p>
        <ul>
          <li>
            <strong>Access</strong> — request a copy of the personal data we hold about you.
          </li>
          <li>
            <strong>Correction</strong> — request correction of inaccurate personal data.
          </li>
          <li>
            <strong>Deletion</strong> — request deletion of your personal data (subject to the audit
            log retention described in Section 8).
          </li>
          <li>
            <strong>Data portability</strong> — request an export of your data in a portable format.
          </li>
        </ul>
        <p>
          To exercise any of these rights, contact us at{" "}
          <a href="mailto:support@labaid.io">support@labaid.io</a>. We will respond within 30 days.
        </p>
      </section>

      <section>
        <h2>10. Children's Privacy</h2>
        <p>
          LabAid is a professional laboratory management tool intended for use by adults in a
          professional workplace setting. We do not knowingly collect personal information from anyone
          under the age of 16. If we become aware that we have collected personal information from a
          child under 16, we will take steps to delete that information promptly. If you believe a
          child under 16 has provided us with personal information, please contact us at{" "}
          <a href="mailto:support@labaid.io">support@labaid.io</a>.
        </p>
      </section>

      <section>
        <h2>11. HIPAA Disclaimer</h2>
        <p>
          LabAid is a laboratory inventory and quality control management tool. It is{" "}
          <strong>not</strong> designed to process, store, or transmit protected health information
          (PHI) as defined by the Health Insurance Portability and Accountability Act (HIPAA). LabAid
          tracks antibody inventory, lot numbers, vial status, and QC documentation — none of which
          constitute PHI. Users should not enter patient data or any information that could identify a
          patient into the Service.
        </p>
      </section>

      <section>
        <h2>12. Changes to This Privacy Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. When we make changes, we will update
          the "Last Updated" date at the top of this document. For material changes, we will notify
          lab administrators via email. Continued use of the Service after changes take effect
          constitutes acceptance of the updated policy.
        </p>
      </section>

      <section>
        <h2>13. Contact Us</h2>
        <p>
          If you have questions, concerns, or requests related to this Privacy Policy or your
          personal data, please contact us at{" "}
          <a href="mailto:support@labaid.io">support@labaid.io</a>.
        </p>
      </section>
    </>
  );
}
