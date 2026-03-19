# PDPA Compliance Audit — HDB Seller Website

> **Usage**: Save to `.claude/commands/pdpa-audit.md` and run with `/pdpa-audit`, or run `claude "Read docs/pdpa-audit.md and follow the instructions"`
>
> **Stack**: Node.js + TypeScript, Express, Prisma ORM, PostgreSQL, Nunjucks, HTMX + Tailwind CSS, bcrypt + TOTP (otplib), Docker on OVH VPS
>
> **Operating Model**: This platform is a transactional processing tool, NOT a long-term data repository. Sensitive data (NRIC, documents, financial info) is processed, then downloaded by the agent and submitted to Huttons Asia Pte Ltd's case submission system for 5-year retention. The platform operates on a process-and-purge basis.

You are performing a PDPA compliance audit on this codebase. For every check below, search the actual code, report what you find (file path + line number), and classify as COMPLIANT / PARTIAL / NON-COMPLIANT.

If a check passes, say COMPLIANT and move on. Do not explain what the check is — just report findings.

---

## 1. Data Classification Enforcement

- [ ] Verify NRIC/FIN is stored encrypted (AES-256) in a separate column or table from general profile data
- [ ] Verify financial data (asking price, loan balance, proceeds) is encrypted at rest
- [ ] Verify NRIC is never displayed unmasked in any template, API response, email, PDF, or log output — must be masked (e.g., ****1234A)
- [ ] Verify financial data is never exposed in public-facing routes or unauthenticated responses

## 2. NRIC Collection & Lifecycle

- [ ] Verify NRIC is NOT collected at registration or sign-up — only at the legally required step (e.g., HDB resale document preparation)
- [ ] Verify NRIC is never used as a database primary key, URL parameter, session value, query string, or filename
- [ ] Verify every access to NRIC data is audit-logged with: who, when, why
- [ ] Verify NRIC input is validated against Singapore format before storage
- [ ] Verify a mechanism exists for the agent to trigger immediate NRIC deletion after downloading and submitting to Huttons
- [ ] Verify an automated fallback exists to redact/delete NRIC if the agent hasn't manually triggered deletion within 7 days of transaction completion

## 3. Consent Management

- [ ] Verify a consent_records table (or equivalent) exists with: seller_id, purpose, consent version, granted_at, withdrawn_at, IP, user agent
- [ ] Verify consent is granular — separate records for: listing creation, buyer data sharing, transaction data sharing, Huttons data transfer, marketing
- [ ] Trace the seller registration or listing creation flow: verify no personal data is written to the database before consent is recorded
- [ ] Search all templates for consent checkboxes. Verify none are pre-checked
- [ ] Verify a consent withdrawal endpoint exists and triggers actual data processing cessation
- [ ] Verify marketing consent is a separate checkbox from service consent in every form
- [ ] Verify consent for Huttons data transfer exists as a separate consent purpose

### Mid-Transaction Consent Withdrawal
- [ ] Verify a withdrawal confirmation screen/flow exists that displays consequences before processing
- [ ] Verify the seller must explicitly confirm before withdrawal is processed (not single-click)
- [ ] Verify withdrawal triggers cascade: listing delist, viewing cancellation, offer voiding, data purge
- [ ] Verify affected parties (buyer agents, viewers) are notified when a withdrawal cancels their involvement
- [ ] Verify one final confirmation message is sent to the seller after withdrawal is processed
- [ ] Verify no further outbound contact occurs after the confirmation message
- [ ] Verify withdrawal is audit-logged with full detail: who, when, what was purged, who was notified
- [ ] Verify consent records and audit logs are retained after withdrawal (not purged with personal data)

## 4. Do Not Call (DNC) Registry

- [ ] Verify transactional vs marketing messages are clearly distinguished in code
- [ ] Verify marketing messages require separate marketing consent checked at send time
- [ ] If DNC check is stubbed: verify no code path can send marketing messages without DNC safeguards. Report stub location.
- [ ] Verify no code path sends unsolicited messages requesting marketing consent (must be presented within platform UI only)

## 5. Collection & Purpose Limitation

- [ ] Review all seller-facing forms. Flag any field that does not map to a documented purpose
- [ ] Verify data collected for listing purposes is not reused for marketing without separate consent
- [ ] Search for any code that uses seller personal data for purposes beyond what's stated in the consent flow

## 6. Retention Enforcement — Process and Purge

- [ ] Verify automated retention jobs exist (cron, node-cron, or equivalent)
- [ ] Check retention rules match the process-and-purge model:
  - NRIC/FIN: deleted immediately after Huttons handoff confirmation, auto-redacted 7 days post-completion as fallback
  - Sensitive documents: deleted immediately after Huttons handoff, auto-deleted 7 days post-completion as fallback
  - Financial info: deleted 7 days post-transaction completion
  - Active listing data: duration of listing + 30 days after close
  - Seller contact info: 30 days post-transaction completion
  - Consent records: until withdrawal + 1 year
  - Audit logs: 2 years
  - Agent records: 2 years after inactivity then anonymised
  - ViewingSlot: 30 days after viewing date if listing closed
  - WeeklyUpdate: 6 months after creation
- [ ] Verify deletion means hard DELETE (not soft-delete) for NRIC and sensitive document data
- [ ] Verify deletion cascades correctly across related tables
- [ ] Verify file system deletion occurs alongside database deletion for uploaded documents/photos

## 7. Huttons Handoff Workflow

- [ ] Verify a "confirm Huttons submission" mechanism exists in the agent workflow (button, route, or equivalent)
- [ ] Verify confirmation triggers immediate hard deletion of NRIC, sensitive documents, and financial data
- [ ] Verify the handoff is audit-logged: who confirmed, when, what data was purged
- [ ] Verify a fallback auto-deletion job exists that catches completed transactions older than 7 days without handoff confirmation
- [ ] Verify the platform retains only consent records and audit logs after handoff (no PII)

## 8. Data Accuracy

- [ ] Verify sellers can view their personal data through the application
- [ ] Verify sellers can correct/update their personal data
- [ ] Verify email or phone verification exists at point of collection

## 9. Data Protection (Technical)

- [ ] Verify TLS is enforced (HTTPS only, no HTTP fallback in production config)
- [ ] Verify role-based access control: sellers see only their own data, agents see only assigned sellers, admin has full access
- [ ] Verify audit logging covers all personal data access (read, create, update, delete)
- [ ] Verify encryption at rest for Tier 1 (NRIC) and Tier 2 (financial) data

## 10. Data Breach Preparedness

- [ ] Check if a breach notification mechanism or template exists in the codebase or documentation
- [ ] Verify logging can reconstruct a breach timeline (who accessed what, when)
- [ ] Verify the system can determine which sellers currently have data on the platform (breach scope)
- [ ] Verify the process-and-purge model is reflected — sellers whose data has been purged are excluded from breach scope

## 11. Subject Access Request (SAR)

### If data is still on the platform
- [ ] Verify a SAR export endpoint exists
- [ ] Verify the export includes: all personal data, consent records, and audit trail
- [ ] Verify NRIC is masked in the export
- [ ] Verify requester identity is verified before fulfilling
- [ ] Verify a data deletion endpoint exists that performs hard DELETE

### If data has been purged
- [ ] Verify the SAR response can include consent records and audit logs (still retained)
- [ ] Verify documentation or code directs the seller to Huttons for archived transaction data

## 12. Cross-Border Data Transfer

- [ ] Check deployment configuration — where is the database hosted?
- [ ] If outside Singapore: verify documentation exists describing safeguards (DPA with hosting provider, encryption)
- [ ] Verify encryption at rest and in transit for any cross-border data flow

## 13. Data Protection Officer (DPO)

- [ ] Check if DPO contact information is displayed on the website (privacy policy page or footer)
- [ ] Verify the privacy policy page is accessible from every page (footer link or similar)

## 14. Privacy Policy Completeness

- [ ] Verify a privacy policy page exists and is publicly accessible
- [ ] Check that it covers:
  - What personal data is collected (including NRIC and when)
  - Purpose(s) of collection
  - How data is used and disclosed
  - That sensitive data is transferred to Huttons Asia Pte Ltd for long-term retention
  - Third parties data is shared with (buyers, HDB, lawyers, conveyancers, Huttons)
  - Platform retention periods (process-and-purge, not 5 years)
  - That 5-year retention is handled by Huttons
  - Consent withdrawal process
  - SAR process (including Huttons contact for archived data)
  - DPO contact details
  - Cross-border transfer disclosure (if applicable)
  - Cookies and tracking disclosure

## 15. Cookie & Tracking Consent

- [ ] Check if the application sets any cookies beyond session cookies
- [ ] If analytics or tracking cookies exist: verify a cookie consent banner is implemented
- [ ] Verify session cookies are configured with httpOnly, secure, sameSite

---

## Output Format

Produce a summary table:

| # | Check | Status | File:Line | Notes |
|---|-------|--------|-----------|-------|
| 1 | NRIC encrypted at rest | COMPLIANT | src/domains/compliance/... | AES-256-GCM |
| 2 | ... | PARTIAL | ... | ... |
| 3 | ... | NON-COMPLIANT | ... | ... |

Then list totals: X COMPLIANT, X PARTIAL, X NON-COMPLIANT.

For any PARTIAL or NON-COMPLIANT finding, provide a specific recommendation.
