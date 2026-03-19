# PDPA Compliance Guide — HDB Seller Website

> **Scope**: Fixed-fee HDB property selling website that collects and processes personal data of HDB sellers in Singapore, including NRIC/FIN, contact details, HDB property addresses, and financial information (asking price, loan details).

> **Operating Model**: This platform is a **transactional processing tool**, not a long-term data repository. Sensitive documents (NRIC, signed forms, etc.) are downloaded by the agent and submitted to the estate agent's (Huttons Asia Pte Ltd) case submission system, which fulfils the 5-year retention obligation. Data on this platform is **processed and purged** — minimising breach exposure.

> **Disclaimer**: This is a developer reference, not legal advice. Consult a qualified Singapore data protection lawyer before launch.

---

## 1. Data Classification

Every feature must respect these sensitivity tiers.

### Tier 1 — Restricted (highest sensitivity)
| Data | Why restricted | Storage rule |
|------|---------------|--------------|
| NRIC / FIN | Governed by PDPA Advisory Guidelines on NRIC (1 Sep 2019). Collection is **prohibited unless legally required or necessary to verify identity to a high degree of fidelity**. | Encrypt at rest (AES-256). Never display full NRIC — mask as `****1234A`. Never use as primary key. **Delete from platform immediately after download and submission to Huttons.** |

### Tier 2 — Sensitive
| Data | Storage rule |
|------|-------------|
| Financial info (asking price, loan balance, expected proceeds) | Encrypt at rest. Access restricted to authenticated seller + authorized staff. Audit log all access. Delete after transaction handoff to Huttons. |

### Tier 3 — Personal
| Data | Storage rule |
|------|-------------|
| Name, phone, email | Standard protection. Collect only with consent. Delete after transaction completion + grace period. |
| HDB address, block/floor/unit, flat type, lease details | Personal data when linked to an identifiable seller. Same retention as above. |

### Tier 4 — Operational
| Data | Storage rule |
|------|-------------|
| Usage analytics, server logs (no PII) | Anonymize/pseudonymize where possible. |

---

## 2. NRIC-Specific Rules

The PDPA Advisory Guidelines on NRIC numbers impose strict requirements.

### When you CAN collect NRIC
- It is **required by law** (e.g., HDB resale application, OTP form, CPF-related documentation)
- You need to **verify identity to a very high degree of fidelity** and no alternative identifier exists

### When you CANNOT collect NRIC
- At account registration or sign-up
- As a general-purpose identifier
- "Just in case" or "for our records"

### Implementation requirements
- [ ] Collect NRIC **only at the step** where legally required (e.g., preparing HDB resale documents) — never at sign-up
- [ ] Display as masked: `****1234A` — never show full NRIC in UI, emails, or generated PDFs unless legally required
- [ ] Store encrypted (AES-256) in a separate column/table from general profile data
- [ ] Log every access to NRIC data: who, when, why
- [ ] **Delete NRIC from the platform immediately after agent downloads and submits to Huttons' case system** — do not wait 30 days
- [ ] Automated fallback: if manual deletion hasn't occurred, auto-redact NRIC 7 days post-transaction completion
- [ ] Never use NRIC as a database primary key, session token, or URL parameter

---

## 3. Consent Management

Every data collection point in the HDB seller flow must have:

1. **Purpose statement** — Tell the seller exactly why you need each piece of data
2. **Explicit opt-in** — Unchecked checkbox, not pre-checked. No "by continuing you agree"
3. **Granular consent** — Separate consent for each purpose:
   - Consent to collect data for creating HDB listing
   - Consent to share data with potential buyers (separate)
   - Consent to share data with HDB/lawyers/conveyancing for resale transaction (separate)
   - Consent to transfer data to Huttons Asia case submission system for long-term retention (separate)
   - Consent for marketing communications (separate, optional)
4. **Withdrawal mechanism** — Easy to find, easy to execute, no penalty

### Implementation checklist
- [ ] Consent records stored in database: seller_id, purpose, consent version, granted_at, withdrawn_at, IP, user agent
- [ ] Consent version tracking — if privacy policy changes, re-collect consent
- [ ] Withdrawal endpoint that actually stops processing (not just a UI toggle)
- [ ] No personal data processing occurs before consent is recorded
- [ ] Marketing consent is never bundled with service consent
- [ ] Consent for Huttons data transfer is recorded before handoff

### Consent withdrawal mid-transaction

A seller may withdraw service consent while their HDB resale is in progress. This must be honoured, but the consequences must be clear before processing.

**Withdrawal types and handling:**

| Withdrawal type | What happens | Transaction impact |
|----------------|-------------|-------------------|
| Marketing consent only | Stop marketing messages. Transaction continues normally. | None |
| Buyer data sharing only | Stop sharing seller details with potential buyers. Delist property from portals. | Listing paused, active viewings cancelled |
| Transaction data sharing | Stop sharing with HDB/lawyers/conveyancers. | Transaction cannot proceed — effectively cancels the sale |
| All service consent | Full withdrawal. All processing stops. | Transaction cancelled, listing removed, data purged |

**Full service consent withdrawal workflow:**

1. Seller initiates withdrawal (self-service in dashboard or request to agent)
2. Platform displays a confirmation screen explaining consequences:
   - "Your HDB listing will be taken down immediately"
   - "All scheduled viewings will be cancelled"
   - "Any accepted offers will be voided — the buyer's agent will be notified"
   - "Documents already submitted to HDB/lawyers cannot be recalled by us"
   - "Your sensitive data will be purged from our platform within 7 days"
   - "For data already submitted to Huttons, contact Huttons directly"
3. Seller confirms they understand and wish to proceed
4. Platform processes the withdrawal:
   - Record withdrawal in consent_records (append-only, with timestamp and IP)
   - Set listing status to withdrawn/delisted
   - Cancel all pending viewings and notify affected viewers
   - Notify buyer agents of any accepted/pending offers being voided
   - Stop all outbound communication to the seller
   - Trigger Tier 1 + Tier 2 data purge (immediate for NRIC/docs, 7-day for remaining)
   - Audit log the entire withdrawal with full detail
5. Send one final confirmation to the seller that withdrawal has been processed (this is permitted — it's fulfilling the withdrawal request, not marketing)

**What the platform retains after withdrawal:**
- Consent records including the withdrawal itself (compliance evidence, 1 year)
- Audit logs of all actions taken (compliance evidence, 2 years)
- No personal data, no NRIC, no financial info, no documents

**What the platform must NOT do:**
- Refuse or delay the withdrawal
- Impose any financial penalty for withdrawing consent
- Continue contacting the seller after withdrawal is confirmed
- Retain personal data beyond what's legally required for compliance evidence
- Present withdrawal as difficult or hidden — it must be easy to find and execute

**CEA / estate agency agreement interaction:**
Withdrawal of PDPA consent does not automatically void a signed estate agency agreement (EAA). These are separate legal instruments. If the seller has signed an EAA with the agent, the contractual obligations (including any commission terms) may still apply independently of PDPA consent withdrawal. Consult a lawyer on the interplay between PDPA withdrawal and EAA obligations. The platform should not attempt to resolve this — it should process the PDPA withdrawal and leave the contractual matter to be handled offline.

**Implementation checklist:**
- [ ] Withdrawal confirmation screen exists showing all consequences
- [ ] Seller must explicitly confirm before withdrawal is processed
- [ ] Withdrawal triggers: listing delist, viewing cancellation, offer voiding, data purge
- [ ] All affected parties (buyer agents, viewers) are notified of cancellation
- [ ] One final confirmation message sent to seller (withdrawal processed)
- [ ] Audit log captures full withdrawal detail: who, when, what was purged, who was notified
- [ ] No further contact after confirmation message
- [ ] Consent records and audit logs retained as compliance evidence

---

## 4. Do Not Call (DNC) Registry

Sellers who sign up and consent to the service have given explicit consent to be contacted for the purpose of their HDB sale. This overrides DNC for transactional messages related to that sale.

### What's covered by seller consent (DNC override)
- Listing updates, viewing notifications, offer alerts, document reminders, transaction progress
- Any message directly related to the seller's active HDB resale transaction

### What requires DNC check or separate marketing consent
- "List another property with us"
- "Refer a friend" campaigns
- Newsletters, promotions, cross-selling
- Any contact after the transaction is completed and data has been purged

### Implementation checklist
- [ ] Transactional vs marketing messages are clearly distinguished in code
- [ ] Marketing messages require separate marketing consent (checked at send time)
- [ ] DNC Registry check before any outbound marketing to contacts who only gave service consent
- [ ] Do NOT send messages requesting marketing consent — present the option within the platform UI instead
- [ ] Keep records of DNC checks performed

---

## 5. Data Protection Obligations

### Collection limitation
- [ ] Collect only what's needed for the stated purpose — no "nice to have" fields
- [ ] Each form field maps to a documented purpose

### Purpose limitation
- [ ] Use data only for the purpose it was collected for
- [ ] Separate consent required for analytics or marketing use

### Retention limitation — Process and Purge Model

This platform operates on a **process-and-purge** basis. Long-term retention (5 years) is handled by Huttons' case submission system.

| Data | Platform retention | Long-term custodian |
|------|-------------------|-------------------|
| NRIC / FIN | Delete immediately after download + Huttons submission. Auto-redact 7 days post-completion as fallback. | Huttons case system (5 years) |
| Sensitive documents (signed forms, OTP docs) | Delete immediately after download + Huttons submission. Auto-delete 7 days post-completion as fallback. | Huttons case system (5 years) |
| Financial info (asking price, loan details) | Delete 7 days post-transaction completion | Huttons case system (5 years) |
| Active listing data | Duration of listing + 30 days after close | Not transferred |
| Seller contact info (name, phone, email) | 30 days post-transaction completion | Huttons case system (5 years) |
| Consent records | Until withdrawal + 1 year for proof | Platform retains (compliance evidence) |
| Audit logs | 2 years | Platform retains (compliance evidence) |
| Marketing consent records | Until withdrawal + 1 year for proof | Platform retains |
| Agent records | 2 years after inactivity then anonymised | Not transferred |
| ViewingSlot | 30 days after viewing date if listing closed | Not transferred |
| WeeklyUpdate | 6 months after creation | Not transferred |

- [ ] Implement automated deletion jobs enforcing these periods
- [ ] Deletion = database DELETE + file system deletion + removal from backups within rotation cycle
- [ ] Agent workflow: download sensitive docs → submit to Huttons → confirm submission → trigger platform deletion
- [ ] Fallback auto-deletion runs even if agent doesn't manually trigger deletion

### Accuracy
- [ ] Sellers can view and correct their personal data
- [ ] Verify data at collection where practical (email verification, SMS OTP)

### Protection
- [ ] Encryption at rest for Tier 1 and Tier 2 data
- [ ] TLS 1.2+ for all data in transit
- [ ] Role-based, least-privilege access control
- [ ] Audit logging on all personal data access

---

## 6. Data Handoff to Huttons

The platform's core data lifecycle ends with handoff to Huttons' case submission system. This is a critical compliance step.

### Handoff workflow
1. Transaction reaches completion
2. Agent downloads all required documents (NRIC copies, signed forms, financial reports) from the platform
3. Agent submits documents to Huttons case submission system
4. Agent confirms submission in the platform (e.g., "Mark as submitted to Huttons" button)
5. Platform triggers deletion of Tier 1 and Tier 2 data
6. Fallback: automated job purges data 7 days post-completion if agent hasn't confirmed

### Implementation checklist
- [ ] "Submit to Huttons" confirmation mechanism exists in the agent workflow
- [ ] Confirmation triggers immediate hard deletion of NRIC, sensitive documents, and financial data from platform
- [ ] Audit log records the handoff: who confirmed, when, what was deleted
- [ ] Seller is notified that their sensitive data has been removed from the platform (optional but good practice)
- [ ] Fallback auto-deletion job runs daily, catches any completed transactions older than 7 days without confirmation

### What the platform retains after handoff
- Consent records (compliance evidence)
- Audit logs (compliance evidence, 2 years)
- Anonymised transaction summary (for platform analytics, no PII)

---

## 7. Data Breach Notification

You MUST notify PDPC within 3 calendar days if a breach:
- Affects 500+ individuals, OR
- Is likely to result in significant harm (NRIC exposure = significant harm)

The process-and-purge model reduces breach impact — if data has been purged, it can't be breached.

### Preparation checklist
- [ ] Breach response plan documented
- [ ] Ability to determine breach scope quickly — which sellers still have data on platform
- [ ] PDPC notification template prepared
- [ ] Affected seller notification template prepared
- [ ] Logging sufficient to reconstruct breach timeline
- [ ] Huttons breach notification process documented (for data held in their system)

---

## 8. Subject Access Requests (SAR)

Sellers can request what personal data you hold and how it's been used.

### If data is still on the platform
- [ ] SAR export endpoint exists
- [ ] Response within 30 days (extendable to 60 with notice)
- [ ] Export includes: all personal data, consent records, audit trail
- [ ] Verify requester identity before fulfilling
- [ ] Data deletion endpoint exists and performs hard DELETE

### If data has been purged and handed to Huttons
- [ ] Inform seller that sensitive data has been removed from the platform
- [ ] Provide consent records and audit logs (still retained)
- [ ] Direct seller to Huttons for access to archived transaction data
- [ ] Document Huttons' SAR contact point in the privacy policy

---

## 9. Cross-Border Data Transfer

If your VPS is hosted outside Singapore (OVH Malaysia):

- [ ] Contractual safeguards with OVH (data processing agreement)
- [ ] Document: what data transfers, where, why, what safeguards
- [ ] Encryption at rest and in transit
- [ ] Note: process-and-purge model limits the duration of cross-border data exposure

---

## 10. Data Protection Officer (DPO)

- [ ] Designate a DPO (can be yourself for small operation)
- [ ] DPO contact publicly accessible on privacy policy page
- [ ] Register with PDPC via ACRA BizFile+

---

## 11. Privacy Policy

Your website must display a privacy policy covering:

- [ ] What personal data is collected (including NRIC and when)
- [ ] Purpose(s) of collection
- [ ] How data is used and disclosed
- [ ] That sensitive data is transferred to Huttons Asia Pte Ltd for long-term retention as required by law
- [ ] Third parties data may be shared with (buyers, HDB, lawyers, conveyancers, Huttons)
- [ ] Platform retention periods (short-term, process-and-purge)
- [ ] That long-term retention (5 years) is handled by Huttons' case system
- [ ] Consent withdrawal process
- [ ] SAR process (including how to request data from Huttons after platform purge)
- [ ] DPO contact details
- [ ] Cross-border transfer disclosure
- [ ] Cookies and tracking disclosure

---

## 12. Technical Implementation Summary

```
DATA LIFECYCLE
  Seller signs up → consent recorded → data collected → transaction processed
  → agent downloads docs → submits to Huttons → confirms in platform
  → platform purges Tier 1 + Tier 2 data → retains only consent + audit logs

DATABASE
├── seller_nric (separate table, AES-256 encrypted, FK to seller)
│   └── PURGED after Huttons handoff or 7-day fallback
├── sensitive_documents (encrypted file references)
│   └── PURGED after Huttons handoff or 7-day fallback
├── financial_reports (AES-256-GCM encrypted reportData)
│   └── PURGED 7 days post-completion
├── consent_records (seller_id, purpose, version, granted_at, withdrawn_at, ip, user_agent)
│   └── RETAINED 1 year post-withdrawal (compliance evidence)
├── audit_logs (who, what_data, action, timestamp, reason)
│   └── RETAINED 2 years (compliance evidence)
├── data_retention_jobs (scheduled deletion per retention policy)
└── dnc_check_cache (phone, checked_at, result) — if sending marketing SMS

API / ROUTES
├── POST /consent — record granular consent
├── DELETE /consent/:purpose — withdraw consent
├── GET /my-data — SAR export
├── DELETE /my-data — data deletion request
├── POST /transaction/:id/confirm-huttons-handoff — agent confirms submission
├── GET /privacy-policy — public page
└── All routes — audit logging middleware

MIDDLEWARE
├── consent-check — block processing if consent missing
├── audit-logger — log personal data access
├── nric-mask — never return full NRIC in responses
└── retention-enforcer — cron for automated deletion

TEMPLATES (Nunjucks)
├── Consent forms — unchecked, granular, versioned (includes Huttons transfer consent)
├── NRIC display — always masked ****1234A
├── Privacy policy — linked from every page footer
├── Data export / deletion — self-service in seller dashboard
└── Huttons handoff confirmation — agent workflow step

SCHEDULED JOBS
├── Huttons handoff fallback — purge Tier 1 + Tier 2 data 7 days post-completion
├── Seller contact cleanup — delete 30 days post-completion
├── Listing data cleanup — delete per retention schedule
├── Consent record cleanup — delete 1 year post-withdrawal
└── Audit log rotation — archive after 2 years
```

---

## Penalties (Quick Reference)

| Violation | Maximum penalty |
|-----------|----------------|
| General PDPA breach | S$1,000,000 or 10% of annual turnover (whichever higher) |
| Failure to notify data breach | Additional penalties under 2021 amendments |
| NRIC misuse | Enforcement action by PDPC |

---

## Key Advantage: Process-and-Purge

By not being the long-term data custodian, this platform:
- **Minimises breach exposure** — data that's been purged can't be breached
- **Simplifies PDPA compliance** — shorter retention = smaller attack surface
- **Clearly delineates responsibility** — Huttons holds the 5-year obligation, the platform handles the transaction workflow
- **Strengthens seller trust** — "we delete your sensitive data as soon as it's submitted to the agency" is a strong privacy message
