import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

export default function TermsPage() {
  return (
    <div className="login-container">
      <div className="login-orb login-orb-1" aria-hidden="true" />
      <div className="login-orb login-orb-2" aria-hidden="true" />
      <div className="login-orb login-orb-3" aria-hidden="true" />

      <div className="login-card login-card--terms">
        <Link to="/login" className="terms-back-link">
          <ArrowLeft size={16} />
          Back to Login
        </Link>

        <h1>Terms of Use</h1>
        <p className="terms-effective">Effective Date: February 8, 2026</p>

        <div className="terms-content">
          <section>
            <h2>1. Acceptance of Terms</h2>
            <p>
              By accessing or using LabAid ("the Service"), you agree to be bound by these Terms of
              Use. If you do not agree, do not use the Service. Continued use after modifications to
              these terms constitutes acceptance of the updated terms.
            </p>
          </section>

          <section>
            <h2>2. Service Description</h2>
            <p>
              LabAid is a cloud-based laboratory inventory management platform designed for flow
              cytometry laboratories. The Service provides antibody and reagent tracking, lot
              management, storage management, barcode scanning, audit logging, and related
              functionality.
            </p>
            <p>
              LabAid is an inventory management tool and does not provide medical advice, diagnostic
              services, or laboratory testing services.
            </p>
          </section>

          <section>
            <h2>3. Accounts and Access</h2>
            <p>
              You must provide accurate information when creating an account. You are responsible for
              maintaining the confidentiality of your credentials and for all activities under your
              account. Notify us immediately of any unauthorized use.
            </p>
            <p>
              Account access is managed by your laboratory administrator, who controls user roles
              and permissions within your organization.
            </p>
          </section>

          <section>
            <h2>4. Data and Privacy</h2>
            <p>
              Your laboratory data remains yours. We act as a data processor on your behalf. We will
              not sell, share, or use your data for purposes other than providing the Service.
            </p>
            <p>
              The Service is not intended to store Protected Health Information (PHI), and users are
              responsible for ensuring no PHI is uploaded.
            </p>
            <p>
              We implement industry-standard security measures including encryption in transit and at
              rest, role-based access controls, and immutable audit logging. However, no system is
              completely secure, and you acknowledge this inherent risk.
            </p>
          </section>

          <section>
            <h2>5. Regulatory Compliance</h2>
            <p>
              LabAid provides tools to assist with inventory management and audit trails. However,{" "}
              <strong>
                each laboratory is solely responsible for its own regulatory compliance
              </strong>
              , including but not limited to:
            </p>
            <ul>
              <li>CLIA (Clinical Laboratory Improvement Amendments)</li>
              <li>HIPAA (Health Insurance Portability and Accountability Act)</li>
              <li>CAP (College of American Pathologists) accreditation requirements</li>
              <li>State and local laboratory regulations</li>
              <li>Institutional review board (IRB) requirements</li>
            </ul>
            <p>
              LabAid does not guarantee compliance with any specific regulatory framework. You should
              consult with your compliance officer to ensure the Service meets your requirements.
            </p>
          </section>

          <section>
            <h2>6. Intellectual Property</h2>
            <p>
              The Service, including its design, code, and documentation, is the intellectual
              property of LabAid. You are granted a limited, non-exclusive, non-transferable license
              to use the Service for your internal laboratory operations.
            </p>
          </section>

          <section>
            <h2>7. Availability and Support</h2>
            <p>
              We strive to maintain high availability but do not guarantee uninterrupted access. The
              Service may be temporarily unavailable for maintenance, updates, or due to
              circumstances beyond our control.
            </p>
            <p>
              We will make reasonable efforts to notify you of planned downtime in advance. Support
              is available through the in-app ticketing system. No service-level agreement (SLA) is
              provided unless separately agreed in writing.
            </p>
          </section>

          <section>
            <h2>8. Limitation of Liability</h2>
            <p>
              To the maximum extent permitted by law, LabAid shall not be liable for any indirect,
              incidental, special, consequential, or punitive damages, including but not limited to
              loss of data, loss of revenue, or interruption of laboratory operations.
            </p>
            <p>
              Our total liability for any claim arising from the Service shall not exceed the amount
              you paid for the Service in the twelve months preceding the claim.
            </p>
          </section>

          <section>
            <h2>9. Payment and Billing</h2>
            <p>
              Paid plans are billed on a recurring basis. You agree to pay all fees associated with
              your selected plan. Failure to pay may result in suspension of write access or
              transition to read-only mode after applicable grace periods. Free trial accounts are
              subject to the limitations described at the time of signup.
            </p>
          </section>

          <section>
            <h2>10. Termination</h2>
            <p>
              Either party may terminate the agreement at any time. After termination, access to the
              Service will be revoked or limited to read-only. Upon request, you may export your
              data within 30 days. Data may be retained for a reasonable period thereafter in
              accordance with our data retention policies.
            </p>
            <p>
              We reserve the right to suspend or terminate accounts that violate these terms or
              engage in activities that harm the Service or other users.
            </p>
          </section>

          <section>
            <h2>11. Changes to Terms</h2>
            <p>
              We may update these Terms of Use from time to time. Material changes will be
              communicated via the Service or email. Your continued use after such changes
              constitutes acceptance.
            </p>
          </section>

          <section>
            <h2>12. Contact</h2>
            <p>
              For questions about these terms, please reach out through the in-app support system or
              contact your laboratory administrator.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
