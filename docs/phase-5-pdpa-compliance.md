# SellMyHouse.sg — Phase 5: PDPA & Compliance Module
# Prerequisites: Phases 1-4 must be complete. Read phase-0-shared-context.md for schema reference.
# This phase builds: consent management, data access & correction, data retention & hard deletion,
# NRIC handling, DNC registry compliance, secure download & server deletion of sensitive documents.

## Phase 5: PDPA & Compliance Module

### 5.1 Consent Management
Granular consent (service vs marketing), withdrawal flow, AML/CFT retention override.

### 5.2 Data Access & Correction
Seller "My Data" page, correction requests, 30-day processing, all logged.

### 5.3 Data Retention & Deletion
The PDPA requires organisations to **cease retaining personal data** when it is no longer necessary — meaning **hard delete or irreversibly anonymise**, not soft delete.

**Hard delete rules by data type:**

*Lead data (no transaction):*
- Flag for **hard deletion** after 12 months of no contact
- If seller withdraws service consent and no transaction exists: **hard delete** within 30 days
- Admin reviews and confirms no legal retention obligation before deletion executes

*Transaction records:*
- **Retain minimum 5 years** after completion (AML/CFT requirement overrides PDPA)
- After 5 years: flag for hard deletion, admin approves
- Consent withdrawal does NOT trigger early deletion — AML/CFT takes precedence

*CDD/AML documents (NRIC copies, identity records):*
- **Retain minimum 5 years** after end of business relationship (AML/CFT)
- After 5 years: **hard delete** database records AND encrypted files from disk

*Consent records:*
- Retain while active + 1 year after withdrawal for audit trail
- After 1 year post-withdrawal: **hard delete**

*Agent accounts (the ONE exception):*
- When agent leaves: **anonymise** (name → "Former Agent [ID]", email/phone → null) but retain record for referential integrity — agent IDs appear in audit logs which are never deleted
- This is the only case where anonymisation instead of hard delete is appropriate

*Audit logs:*
- **Never deleted.** Permanent compliance record. Must be self-contained so they remain meaningful after referenced entities are hard deleted.

**Implementation:**
- Scheduled weekly job flags records past retention limits
- Admin dashboard shows flagged records with recommended action
- Admin reviews, confirms no legal exception, approves deletion
- System executes: Prisma `delete` (not soft-delete flag) + `fs.unlink()` for files
- Audit log entry created for each deletion (references deleted entity but is self-contained)

### 5.4 NRIC Handling
Last 4 chars in DB, full docs encrypted at rest (AES-256), masked display (SXXXX567A), agent-only access for CDD review.

### 5.5 DNC Registry
Marketing messages blocked without explicit marketing consent. All sends logged.

### 5.6 Secure Download & Server Deletion of Sensitive Documents
Sensitive uploaded documents (NRIC copies, CDD identity documents, scanned OTPs, commission invoices) should not remain on the server indefinitely. Once the agent/admin has downloaded them to secure offline storage, they can be permanently deleted from the server to minimise attack surface.

**Which documents this applies to:**
- CDD identity documents (NRIC copies, passport scans) — in `/uploads/documents/`
- Scanned signed OTP copies — in `/uploads/otp/`
- Commission invoices — in `/uploads/invoices/`
- Any other uploaded sensitive files

**This does NOT apply to:**
- Seller-uploaded property photos (these are needed for active listings and are not sensitive personal data)
- Database records (CDD metadata, consent records, audit logs — these stay in the database regardless)

**Availability:**
- Only available after the transaction is **completed** (status = completed). System blocks this action during active transactions.
- Only accessible by agent (for their own sellers) or admin (for any seller)

**UI flow:**
1. In the seller detail view or transaction detail view, each uploaded sensitive document shows a "Download & Delete from Server" button
2. There is also a bulk action: "Download All & Delete from Server" for all sensitive documents in a transaction
3. On click, a confirmation modal appears:

```
⚠️ Download & Permanently Delete

You are about to download [filename / N files] and permanently
delete them from the server. This action cannot be undone.

These documents are required to be retained for 5 years under
AML/CFT regulations. By proceeding, you confirm that:

☐ I have stored these documents securely offline
☐ I can produce these documents if requested by authorities
☐ I understand this deletion is permanent and cannot be reversed

[Cancel]  [Download & Delete]
```

4. Both checkboxes must be ticked before the "Download & Delete" button becomes active
5. On confirm:
   - System initiates file download to the agent's device
   - System waits for download to complete (or provides a brief delay)
   - System hard deletes the file(s) from the server (`fs.unlink()`)
   - System updates the relevant record:
     - `CddRecord.documents`: remove the file path from the JSON array, replace with `{deletedFromServer: true, deletedAt: timestamp, downloadedBy: agentId}`
     - `Otp.scannedCopyPath`: set to null, add `scannedCopyDeletedAt` timestamp
     - `CommissionInvoice.invoiceFilePath`: set to null, add `invoiceDeletedAt` timestamp
   - System creates audit log entry: `documents.downloaded_and_deleted` with details:
     ```json
     {
       "files": ["filename1.pdf", "filename2.jpg"],
       "transactionId": "...",
       "downloadedBy": "agentId",
       "offlineRetentionConfirmed": true,
       "reason": "server data minimisation"
     }
     ```

**Important: the database metadata stays.** After deletion, the system still shows:
- CDD was completed (identity verified: yes, verified by: agent name, verified at: date)
- OTP was signed (status history intact, serial number recorded)
- Invoice was sent (sent date, sent via, payment status)

Only the actual files are removed. The proof that due diligence was performed remains in the database and audit trail.

### Tests for Phase 5:
```
Unit Tests:
- NRIC masking: "S1234567A" → "SXXXX567A"
- Consent validation: rejects lead without service consent
- Consent validation: accepts lead without marketing consent
- Retention: correctly flags leads with no activity >12 months
- Retention: does NOT flag transaction records <5 years old
- Retention: flags transaction records >5 years old
- Retention: does NOT flag CDD records during active business relationship
- DNC: marketing message blocked without consent
- DNC: service message allowed without marketing consent
- File encryption: AES-256 encrypt/decrypt round-trip
- Download-and-delete: blocked during active transaction (status != completed)
- Download-and-delete: blocked if confirmation checkboxes not ticked

Integration Tests:
- Consent withdrawal (marketing): stops all marketing, audit logged
- Consent withdrawal (service, no transaction): hard deletes seller personal data within 30 days
- Consent withdrawal (service, active transaction): flags but does NOT delete (AML/CFT override)
- Data access page shows complete personal data
- Data correction flow: request → agent notified → applied → audit logged
- Retention: lead flagged → admin approves → hard delete executes → database record gone → files gone → audit log remains
- Retention: transaction <5 years → admin cannot approve early deletion (system blocks)
- Retention: CDD documents hard deleted after 5 years → encrypted files removed from disk
- Agent anonymisation: name/email/phone nullified → audit logs still reference agent ID → agent record still exists with anonymised data
- Hard delete verification: after deletion, SELECT by ID returns null (not a soft-deleted record)
- NRIC: encrypted storage, agent-only access, seller cannot view full NRIC
- Download-and-delete: file downloaded → file deleted from disk → database record updated (filePath null, deletedAt set) → CDD verification metadata still intact → audit log created
- Download-and-delete: after deletion, file no longer accessible via any route (404)
- Download-and-delete: attempt on active transaction returns error (403)
- Download-and-delete: bulk download packages all files → deletes all → all records updated
```

