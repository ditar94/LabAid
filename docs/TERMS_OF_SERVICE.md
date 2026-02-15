# LabAid Terms of Service

**DRAFT -- This document has not been reviewed by legal counsel. It must undergo professional legal review before publication or enforcement.**

**Last Updated:** February 14, 2026

---

These Terms of Service ("Terms") govern your access to and use of the LabAid platform ("Service"), operated by LabAid ("we," "us," or "our"). By accessing or using the Service, you agree to be bound by these Terms. If you do not agree, you may not use the Service.

---

## 1. Definitions

- **"Lab"** means the laboratory organization that has registered for a LabAid account.
- **"Lab Administrator"** means the individual(s) designated by the Lab to manage the Lab's account, users, and settings within the Service.
- **"User"** means any individual who accesses the Service under a Lab's account, including Lab Administrators, supervisors, technicians, and read-only users.
- **"Lab Data"** means all data entered into or generated within the Service by or on behalf of a Lab, including antibody inventory records, lot information, QC documents, and audit logs.
- **"Platform"** means the LabAid web application, APIs, and all related infrastructure.

---

## 2. Acceptance of Terms

By creating an account, accepting an invitation to join a Lab, or otherwise accessing or using the Service, you represent that:

1. You have the authority to bind yourself (and, if applicable, your Lab) to these Terms.
2. You are at least 18 years of age.
3. Your use of the Service will comply with all applicable laws and regulations.

If you are accepting these Terms on behalf of a Lab or other legal entity, you represent and warrant that you have the authority to bind that entity to these Terms.

---

## 3. The Service

LabAid is a site-managed SaaS platform designed for flow cytometry laboratories to track antibody inventory, manage lot information, record QC status, and maintain audit logs. We host and manage the Platform on behalf of Labs. The Service is hosted on Google Cloud Platform infrastructure located in United States data centers, utilizing Cloud Run, Cloud SQL, and Firebase Hosting.

We reserve the right to modify, update, or discontinue any feature or aspect of the Service at any time. We will make reasonable efforts to provide advance notice of material changes.

---

## 4. Accounts and Access

### 4.1 Lab Accounts

A Lab account is created by a Lab Administrator during initial setup. The Lab Administrator is responsible for managing the Lab's account and its Users.

### 4.2 User Accounts

Users are invited to the Service via email by a Lab Administrator. Each User is assigned a role that determines their level of access:

- **Lab Administrator** -- Full administrative control over the Lab's account, users, and settings.
- **Supervisor** -- Elevated access to manage inventory and review operations.
- **Technician** -- Standard access to perform day-to-day inventory operations.
- **Read-Only** -- View-only access to Lab Data.

### 4.3 Account Security

You are responsible for maintaining the confidentiality of your login credentials. You must immediately notify your Lab Administrator and LabAid at [CONTACT_EMAIL] if you become aware of any unauthorized use of your account. We are not liable for any loss arising from unauthorized access to your account resulting from your failure to safeguard your credentials.

### 4.4 Account Accuracy

You agree to provide accurate, current, and complete information when creating or updating your account. Lab Administrators are responsible for ensuring that their Users' access levels are appropriate and up to date.

---

## 5. Permitted Use

You may use the Service solely for its intended purpose: managing flow cytometry antibody inventory, lot tracking, QC documentation, and related laboratory operations. You agree not to:

1. Use the Service for any unlawful purpose or in violation of any applicable law or regulation.
2. Attempt to gain unauthorized access to any part of the Service, other accounts, or any systems or networks connected to the Service.
3. Reverse engineer, decompile, disassemble, or otherwise attempt to derive the source code of the Platform.
4. Interfere with or disrupt the integrity or performance of the Service.
5. Use the Service to store or transmit malicious code, viruses, or harmful data.
6. Use the Service to store protected health information (PHI), personally identifiable patient data, or any data subject to HIPAA or similar healthcare privacy regulations. The Service is designed for laboratory inventory management, not patient data management.
7. Sublicense, resell, or redistribute access to the Service without our prior written consent.
8. Use automated scripts, bots, or scrapers to access or extract data from the Service, except through our documented APIs and within applicable rate limits.
9. Share login credentials between multiple individuals. Each User must have their own account.

---

## 6. Data Ownership and Lab Data

### 6.1 Your Data

Labs retain full ownership of all Lab Data entered into the Service. We do not claim any ownership rights over Lab Data. By using the Service, you grant us a limited, non-exclusive license to store, process, and display Lab Data solely for the purpose of providing and improving the Service.

### 6.2 Data Security

We take the security of Lab Data seriously. We implement reasonable administrative, technical, and physical safeguards to protect Lab Data, including:

- Encrypted data transmission (TLS/HTTPS).
- Encrypted data at rest via Google Cloud Platform's default encryption.
- Role-based access controls to limit data access to authorized Users.
- JWT-based authentication with scoped permissions.
- Immutable, append-only audit logs that record all data modifications and cannot be altered or deleted.

While we employ commercially reasonable measures to protect Lab Data, no method of electronic storage or transmission is completely secure. We cannot guarantee absolute security.

### 6.3 Data Retention

- **Active Labs:** All Lab Data is retained for the duration of the Lab's active subscription.
- **Suspended or Inactive Labs:** Lab Data is preserved in a read-only state. We do not delete Lab Data from suspended or inactive accounts.
- **Audit Logs:** Audit logs are immutable and append-only. They are retained indefinitely and cannot be modified or deleted by any party, including LabAid.

### 6.4 Data Export

Labs may request an export of their Lab Data at any time by contacting [CONTACT_EMAIL]. We will provide data exports in a reasonable timeframe and in a standard, machine-readable format.

### 6.5 HIPAA Disclaimer

The Service is designed for laboratory inventory management (antibody tracking, lot management, QC documentation) and is not intended for the storage or processing of protected health information (PHI) or patient data. The Service is not HIPAA-compliant, and we do not enter into Business Associate Agreements (BAAs). You must not use the Service to store, process, or transmit any data that is subject to HIPAA or similar healthcare privacy regulations.

---

## 7. Intellectual Property

### 7.1 Our Intellectual Property

The Service, including the Platform, its design, code, features, documentation, trademarks, and all related intellectual property, is and remains the exclusive property of LabAid. These Terms do not grant you any rights to our intellectual property except for the limited right to use the Service as described herein.

### 7.2 Feedback

If you provide us with suggestions, ideas, or feedback regarding the Service ("Feedback"), you grant us a perpetual, irrevocable, royalty-free, worldwide license to use, modify, and incorporate such Feedback into the Service without any obligation to you.

---

## 8. Billing and Payment

### 8.1 Subscription and Billing

Labs are billed according to the plan and pricing agreed upon at the time of account creation or renewal. Billing details and payment terms will be communicated to the Lab Administrator.

### 8.2 Billing Status

Lab accounts operate under one of the following billing statuses:

- **Trial** -- The Lab is using the Service during a trial period at no charge.
- **Active** -- The Lab has a current, paid subscription.
- **Past Due** -- Payment is overdue. Labs with a past-due status may experience restricted access.
- **Cancelled** -- The Lab's subscription has been cancelled.

### 8.3 Past-Due Accounts

If a Lab's account becomes past due, we may suspend the account. Suspended Labs are placed in read-only mode: Users may view existing Lab Data but cannot create, modify, or delete records. We will make reasonable efforts to notify the Lab Administrator before suspending an account.

### 8.4 Taxes

Unless otherwise stated, fees do not include applicable taxes. You are responsible for paying all taxes associated with your use of the Service, excluding taxes based on our net income.

### 8.5 Refunds

Fees are generally non-refundable. Exceptions may be made at our sole discretion. Contact [CONTACT_EMAIL] for refund inquiries.

---

## 9. Termination

### 9.1 Termination by Lab

A Lab Administrator may request termination of the Lab's account at any time by contacting [CONTACT_EMAIL]. Upon termination:

- The Lab may request an export of its Lab Data before the account is closed.
- We will retain Lab Data in a read-only state for a reasonable period following termination to allow for data retrieval, after which it may be permanently deleted.

### 9.2 Termination by LabAid

We may suspend or terminate your access to the Service at any time if:

1. You breach these Terms.
2. Your Lab's account is past due and remains unpaid after reasonable notice.
3. Your use of the Service poses a security risk or may cause harm to other users or our infrastructure.
4. We are required to do so by law.

We will make reasonable efforts to provide notice before termination, except where immediate action is necessary to protect the Service or comply with legal obligations.

### 9.3 Effect of Termination

Upon termination, your right to access the Service ceases. Sections of these Terms that by their nature should survive termination will survive, including but not limited to Sections 6 (Data Ownership), 7 (Intellectual Property), 10 (Limitation of Liability), 11 (Disclaimers), and 12 (Indemnification).

---

## 10. Limitation of Liability

TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW:

1. **No Consequential Damages.** In no event will LabAid be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of profits, revenue, data, or business opportunities, arising out of or related to your use of the Service, regardless of the theory of liability (contract, tort, strict liability, or otherwise), even if we have been advised of the possibility of such damages.

2. **Liability Cap.** Our total cumulative liability to you for all claims arising out of or related to these Terms or the Service will not exceed the total fees paid by your Lab to LabAid during the twelve (12) months immediately preceding the event giving rise to the claim.

3. **Essential Purpose.** The limitations in this section apply even if any limited remedy fails of its essential purpose.

---

## 11. Disclaimers

### 11.1 "As Is" Service

THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS, IMPLIED, OR STATUTORY. WE DISCLAIM ALL WARRANTIES, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT.

### 11.2 No Service Level Guarantee

As an early-stage product, we do not currently offer formal Service Level Agreements (SLAs) or guaranteed uptime commitments. We will make commercially reasonable efforts to maintain the availability and reliability of the Service, but we do not warrant that the Service will be uninterrupted, error-free, or available at all times.

### 11.3 No Regulatory Compliance Guarantee

The Service is a tool for laboratory inventory management. It is your responsibility to ensure that your use of the Service complies with all applicable laws, regulations, and institutional policies, including but not limited to laboratory accreditation requirements, quality management standards, and data protection regulations.

### 11.4 Data Accuracy

While the Service includes features such as audit logs and QC tracking to support data integrity, you are solely responsible for the accuracy and completeness of Lab Data entered into the Service. We are not liable for any decisions made or actions taken based on Lab Data.

---

## 12. Indemnification

You agree to indemnify, defend, and hold harmless LabAid and its officers, directors, employees, and agents from and against any claims, liabilities, damages, losses, costs, and expenses (including reasonable attorneys' fees) arising out of or related to:

1. Your use of the Service.
2. Your breach of these Terms.
3. Your violation of any applicable law or regulation.
4. Any Lab Data you or your Users enter into the Service.
5. Any dispute between you and your Users or any third party relating to the Service.

---

## 13. Governing Law and Dispute Resolution

### 13.1 Governing Law

These Terms are governed by and construed in accordance with the laws of the State of Delaware, United States, without regard to its conflict of law principles.

### 13.2 Dispute Resolution

Any dispute arising out of or related to these Terms or the Service will first be attempted to be resolved through good-faith negotiation. If the dispute cannot be resolved through negotiation within thirty (30) days, either party may pursue resolution through binding arbitration or in the courts of competent jurisdiction in the State of Delaware.

### 13.3 Class Action Waiver

To the maximum extent permitted by applicable law, you agree that any dispute resolution proceedings will be conducted only on an individual basis and not in a class, consolidated, or representative action.

---

## 14. Changes to These Terms

We may update these Terms from time to time. When we make material changes, we will:

1. Update the "Last Updated" date at the top of this document.
2. Notify Lab Administrators via email at least thirty (30) days before the changes take effect.
3. Provide a summary of the material changes.

Your continued use of the Service after the effective date of updated Terms constitutes your acceptance of the changes. If you do not agree with the updated Terms, you must stop using the Service and may request account termination.

---

## 15. General Provisions

### 15.1 Entire Agreement

These Terms, together with any applicable order forms or pricing agreements, constitute the entire agreement between you and LabAid regarding the Service and supersede all prior agreements and understandings.

### 15.2 Severability

If any provision of these Terms is found to be unenforceable or invalid, that provision will be limited or eliminated to the minimum extent necessary, and the remaining provisions will remain in full force and effect.

### 15.3 Waiver

Our failure to enforce any right or provision of these Terms will not be deemed a waiver of such right or provision.

### 15.4 Assignment

You may not assign or transfer these Terms or your rights under them without our prior written consent. We may assign these Terms without restriction.

### 15.5 Notices

Notices to LabAid should be sent to [CONTACT_EMAIL]. Notices to you will be sent to the email address associated with your account or your Lab Administrator's email address.

### 15.6 Force Majeure

We will not be liable for any delay or failure to perform our obligations under these Terms if such delay or failure results from circumstances beyond our reasonable control, including but not limited to natural disasters, acts of government, internet or infrastructure outages, or pandemics.

---

## 16. Contact Us

If you have questions about these Terms, please contact us at:

**Email:** [CONTACT_EMAIL]

---

**DRAFT -- This document requires review by qualified legal counsel before it is published, presented to users, or relied upon for any legal purpose.**
