# Code Quality Review — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Review the entire codebase for bugs, logic errors, race conditions, error handling gaps, and missing validation. Produce a consolidated findings report.

**Architecture:** Dispatch 7 parallel review agents (one per domain batch). Each agent reads all non-test source files in its batch, evaluates code against 7 review categories, and returns structured findings. A final consolidation task merges all findings into a single report sorted by severity.

**Tech Stack:** Claude Code agents (read-only), Markdown report output

**Spec:** `docs/superpowers/specs/2026-03-28-code-quality-review-design.md`

**Parallelism:** Tasks 1-7 are independent and MUST be dispatched in parallel. Task 8 depends on all 7 completing.

---

## Review Categories (all agents use these)

1. **Bugs** — logic errors, wrong conditions, off-by-one, undefined access, dead code paths
2. **Race conditions** — concurrent DB ops without transactions, TOCTOU, parallel request conflicts
3. **Error handling gaps** — unhandled promise rejections, swallowed errors, missing try/catch, generic catch-alls
4. **Missing validation** — unchecked user input reaching DB/business logic, missing type coercion, boundary conditions
5. **State machine violations** — invalid status transitions, missing guard checks
6. **Data integrity** — missing DB transactions for multi-write operations, orphaned records
7. **Security gaps** — auth bypass, injection, access control issues (flag even if overlaps with recent security audit)

## Finding Format (all agents use this)

```markdown
### [SEVERITY] Category — Short description
- **File:** path/to/file.ts:line
- **Category:** Bugs | Race conditions | Error handling | Validation | State machine | Data integrity | Security
- **Severity:** Critical | High | Medium | Low
- **Description:** What the issue is and why it matters
- **Suggested fix:** Brief approach to resolving
```

## Threshold

Flag anything ≥50% likely to be a real issue. False positives acceptable.

---

### Task 1: Review Batch 1 — auth, agent

**Files to review (read-only):**
- `src/domains/auth/auth.service.ts`
- `src/domains/auth/auth.repository.ts`
- `src/domains/auth/auth.router.ts`
- `src/domains/auth/auth.login.router.ts`
- `src/domains/auth/auth.registration.router.ts`
- `src/domains/auth/auth.setup-account.router.ts`
- `src/domains/auth/auth.two-factor.router.ts`
- `src/domains/auth/auth.types.ts`
- `src/domains/auth/auth.validator.ts`
- `src/domains/agent/agent.service.ts`
- `src/domains/agent/agent.repository.ts`
- `src/domains/agent/agent.router.ts`
- `src/domains/agent/agent.types.ts`
- `src/domains/agent/agent.validator.ts`

**Focus areas:**
- Session handling — does session fixation protection exist? Are sessions invalidated on password change/2FA toggle?
- Password reset flow — timing leaks? Token reuse? Expiry enforcement?
- 2FA — bypass paths? Recovery codes handled correctly? TOTP window validation?
- Agent CRUD — authorisation checks on all routes? Can agents access other agents' data?
- Login rate limiting — applied consistently across all login endpoints?
- Registration — duplicate email handling, race condition on concurrent registrations

- [ ] **Step 1: Read all files listed above**
- [ ] **Step 2: Evaluate each file against all 7 review categories**
- [ ] **Step 3: Document findings using the Finding Format above**
- [ ] **Step 4: Return the complete findings list**

---

### Task 2: Review Batch 2 — transaction, offer

**Files to review (read-only):**
- `src/domains/transaction/transaction.service.ts`
- `src/domains/transaction/transaction.repository.ts`
- `src/domains/transaction/transaction.router.ts`
- `src/domains/transaction/transaction.types.ts`
- `src/domains/transaction/transaction.validator.ts`
- `src/domains/transaction/transaction.jobs.ts`
- `src/domains/offer/offer.service.ts`
- `src/domains/offer/offer.repository.ts`
- `src/domains/offer/offer.router.ts`
- `src/domains/offer/offer.types.ts`
- `src/domains/offer/offer.validator.ts`

**Focus areas:**
- Transaction state machine — are all status transitions validated? Can invalid transitions occur via concurrent requests?
- Offer state machine — same concerns. Can an offer be accepted twice? Counter-offer race conditions?
- Financial data — is the $1,499 + GST commission read from SystemSetting, never hardcoded? Any arithmetic that could produce floating point errors?
- DB transactions — multi-step operations (create offer + update transaction status) wrapped in Prisma transactions?
- Authorization — can sellers modify each other's transactions? Can agents access transactions they're not assigned to?
- Jobs — do scheduled jobs handle partial failures? What happens if a job crashes mid-batch?

- [ ] **Step 1: Read all files listed above**
- [ ] **Step 2: Evaluate each file against all 7 review categories**
- [ ] **Step 3: Document findings using the Finding Format above**
- [ ] **Step 4: Return the complete findings list**

---

### Task 3: Review Batch 3 — seller, compliance

**Files to review (read-only):**
- `src/domains/seller/seller.service.ts`
- `src/domains/seller/seller.repository.ts`
- `src/domains/seller/seller.router.ts`
- `src/domains/seller/seller.types.ts`
- `src/domains/seller/seller.validator.ts`
- `src/domains/seller/seller-document.service.ts`
- `src/domains/seller/seller-document.repository.ts`
- `src/domains/seller/seller-document.validator.ts`
- `src/domains/seller/account-delete.service.ts`
- `src/domains/seller/case-flag.service.ts`
- `src/domains/seller/case-flag.repository.ts`
- `src/domains/seller/case-flag.types.ts`
- `src/domains/seller/case-flag.validator.ts`
- `src/domains/compliance/compliance.service.ts`
- `src/domains/compliance/compliance.repository.ts`
- `src/domains/compliance/compliance.router.ts`
- `src/domains/compliance/compliance.types.ts`
- `src/domains/compliance/compliance.validator.ts`

**Focus areas:**
- PDPA compliance — hard deletes for personal data (Prisma `delete` + `fs.unlink()`)? Granular consent (service vs marketing separate)?
- NRIC handling — only last 4 chars stored? Full docs encrypted AES-256? Masked display?
- Document uploads — file type validation (jpg/jpeg/png/pdf only)? Size limits enforced? Path traversal prevention?
- Account deletion — does it anonymise correctly (name → "Former Agent [ID]", email → `anonymised-{id}@deleted.local`)?
- Data lifecycle — are retention tiers (7 day auto-delete, 7 day auto-redact, 30 day anonymise) correctly implemented?
- Consent records — append-only? No updates/deletes on consent records?
- Case flags — authorization checks? Can sellers manipulate their own flags?

- [ ] **Step 1: Read all files listed above**
- [ ] **Step 2: Evaluate each file against all 7 review categories**
- [ ] **Step 3: Document findings using the Finding Format above**
- [ ] **Step 4: Return the complete findings list**

---

### Task 4: Review Batch 4 — lead, viewing, notification

**Files to review (read-only):**
- `src/domains/lead/lead.service.ts`
- `src/domains/lead/lead.repository.ts`
- `src/domains/lead/lead.router.ts`
- `src/domains/lead/lead.types.ts`
- `src/domains/lead/lead.validator.ts`
- `src/domains/lead/verification.service.ts`
- `src/domains/lead/verification.router.ts`
- `src/domains/lead/verification.types.ts`
- `src/domains/viewing/viewing.service.ts`
- `src/domains/viewing/viewing.repository.ts`
- `src/domains/viewing/viewing.router.ts`
- `src/domains/viewing/viewing.types.ts`
- `src/domains/viewing/viewing.validator.ts`
- `src/domains/viewing/viewing.jobs.ts`
- `src/domains/viewing/recurring.utils.ts`
- `src/domains/notification/notification.service.ts`
- `src/domains/notification/notification.repository.ts`
- `src/domains/notification/notification.router.ts`
- `src/domains/notification/notification.types.ts`
- `src/domains/notification/notification.validator.ts`
- `src/domains/notification/notification.templates.ts`
- `src/domains/notification/providers/email.provider.ts`
- `src/domains/notification/providers/in-app.provider.ts`
- `src/domains/notification/providers/whatsapp.provider.ts`

**Focus areas:**
- Lead submission — rate limiting (3/hour)? Input sanitization? Duplicate detection?
- Lead verification — token expiry? Reuse prevention?
- Viewing booking — rate limiting (3/phone/day)? Double booking? Time conflict detection?
- Recurring viewings — edge cases in recurrence utils (timezone, DST, month boundaries)?
- Notification dispatch — does it check `seller.notificationPreference`? Marketing consent checked separately?
- WhatsApp provider — DNC registry check before sending? Error handling on API failures?
- Email provider — error handling? Retry logic? Template injection?
- In-app provider — authorization? Can users see others' notifications?

- [ ] **Step 1: Read all files listed above**
- [ ] **Step 2: Evaluate each file against all 7 review categories**
- [ ] **Step 3: Document findings using the Finding Format above**
- [ ] **Step 4: Return the complete findings list**

---

### Task 5: Review Batch 5 — property, hdb, content

**Files to review (read-only):**
- `src/domains/property/property.service.ts`
- `src/domains/property/property.repository.ts`
- `src/domains/property/property.router.ts`
- `src/domains/property/property.types.ts`
- `src/domains/property/property.validator.ts`
- `src/domains/property/financial.calculator.ts`
- `src/domains/property/financial.service.ts`
- `src/domains/property/financial.repository.ts`
- `src/domains/property/financial.router.ts`
- `src/domains/property/financial.types.ts`
- `src/domains/property/financial.validator.ts`
- `src/domains/property/photo.service.ts`
- `src/domains/property/portal.formatter.ts`
- `src/domains/property/portal.repository.ts`
- `src/domains/property/portal.service.ts`
- `src/domains/property/portal.router.ts`
- `src/domains/property/resale-levy.ts`
- `src/domains/hdb/service.ts`
- `src/domains/hdb/repository.ts`
- `src/domains/hdb/sync.service.ts`
- `src/domains/hdb/types.ts`
- `src/domains/content/content.service.ts`
- `src/domains/content/content.repository.ts`
- `src/domains/content/content.types.ts`
- `src/domains/content/content.validator.ts`
- `src/domains/content/content.jobs.ts`
- `src/domains/content/testimonial.router.ts`

**Focus areas:**
- Financial calculator — floating point arithmetic? Rounding errors? Edge cases (zero values, negative values)?
- Resale levy calculation — correct formula? Edge cases?
- Property photo uploads — file validation? Size limits? Authorization?
- Portal formatter — HTML/content injection via property data?
- HDB sync — error handling on external API failures? Partial sync recovery?
- Content — user-supplied content sanitized? XSS in testimonials?
- Financial disclaimers — present on all estimate outputs?

- [ ] **Step 1: Read all files listed above**
- [ ] **Step 2: Evaluate each file against all 7 review categories**
- [ ] **Step 3: Document findings using the Finding Format above**
- [ ] **Step 4: Return the complete findings list**

---

### Task 6: Review Batch 6 — admin, profile, agent-settings, public, review, shared

**Files to review (read-only):**
- `src/domains/admin/admin.service.ts`
- `src/domains/admin/admin.repository.ts`
- `src/domains/admin/admin.router.ts`
- `src/domains/admin/admin.types.ts`
- `src/domains/admin/admin.validator.ts`
- `src/domains/profile/profile.service.ts`
- `src/domains/profile/profile.repository.ts`
- `src/domains/profile/profile.router.ts`
- `src/domains/profile/profile.types.ts`
- `src/domains/profile/profile.multer.ts`
- `src/domains/agent-settings/agent-settings.service.ts`
- `src/domains/agent-settings/agent-settings.repository.ts`
- `src/domains/agent-settings/agent-settings.router.ts`
- `src/domains/agent-settings/agent-settings.types.ts`
- `src/domains/agent-settings/agent-settings.validator.ts`
- `src/domains/public/public.router.ts`
- `src/domains/review/review.service.ts`
- `src/domains/review/review.repository.ts`
- `src/domains/review/review.router.ts`
- `src/domains/review/review.types.ts`
- `src/domains/review/review.validator.ts`
- `src/domains/shared/errors.ts`
- `src/domains/shared/encryption.ts`
- `src/domains/shared/nric.ts`
- `src/domains/shared/audit.service.ts`
- `src/domains/shared/audit.repository.ts`
- `src/domains/shared/audit.types.ts`
- `src/domains/shared/settings.service.ts`
- `src/domains/shared/settings.repository.ts`
- `src/domains/shared/settings.types.ts`
- `src/domains/shared/ai/ai.facade.ts`
- `src/domains/shared/ai/ai.types.ts`

**Focus areas:**
- Admin — authorization (admin-only routes)? Can non-admins access admin endpoints?
- Profile uploads — multer config secure? File type/size validation?
- Agent settings — can agents modify other agents' settings?
- Public routes — input sanitization on all public-facing endpoints?
- Reviews — can users post reviews for transactions they're not part of? Content sanitization?
- Shared errors — do all error classes serialize safely (no stack trace leaks to clients)?
- Encryption — key management? IV reuse? Correct AES-256 mode?
- NRIC utils — masking correct? Edge cases (non-standard formats)?
- Audit service — truly append-only? No delete/update paths?
- Settings service — caching race conditions? Stale cache handling?
- AI facade — error handling on provider failures? Input sanitization before sending to AI?

- [ ] **Step 1: Read all files listed above**
- [ ] **Step 2: Evaluate each file against all 7 review categories**
- [ ] **Step 3: Document findings using the Finding Format above**
- [ ] **Step 4: Return the complete findings list**

---

### Task 7: Review Batch 7 — infra layer

**Files to review (read-only):**
- `src/infra/http/app.ts`
- `src/infra/http/health.router.ts`
- `src/infra/http/session.d.ts`
- `src/infra/http/middleware/require-auth.ts`
- `src/infra/http/middleware/error-handler.ts`
- `src/infra/http/middleware/session.ts`
- `src/infra/http/middleware/passport.ts`
- `src/infra/http/middleware/csrf.ts`
- `src/infra/http/middleware/rate-limit.ts`
- `src/infra/http/middleware/maintenance.ts`
- `src/infra/http/middleware/request-logger.ts`
- `src/infra/http/middleware/referral-tracking.ts`
- `src/infra/http/middleware/portals-badge.ts`
- `src/infra/http/filters/date.filter.ts`
- `src/infra/jobs/purge-sensitive-docs.job.ts`
- `src/infra/jobs/anonymise-offers.job.ts`
- `src/infra/jobs/retention.job.ts`
- `src/infra/jobs/runner.ts`
- `src/infra/database/prisma.ts`
- `src/infra/cache/memory-cache.ts`
- `src/infra/security/key-provider.ts`
- `src/infra/security/key-provider-aws.ts`
- `src/infra/security/virus-scanner.ts`
- `src/infra/storage/storage.types.ts`
- `src/infra/storage/encrypted-storage.ts`
- `src/infra/storage/local-storage.ts`
- `src/infra/email/system-mailer.ts`
- `src/infra/logger.ts`

**Focus areas:**
- Auth middleware — bypass paths? Does it cover all protected routes?
- Error handler — does it leak stack traces or internal details in production?
- CSRF — applied to all state-changing routes? Token validation correct?
- Rate limiting — applied consistently? Correct limits per spec (5 auth/15min, 100 API/min)?
- Session — secure cookie flags? Session fixation protection?
- Purge jobs — do they correctly implement tier 1 (hard delete + fs.unlink), tier 2 (redact to null), tier 3 (anonymise)?
- Retention job — handles partial failures? What if DB delete succeeds but file unlink fails?
- Job runner — concurrent job execution safety? Crash recovery?
- Prisma client — connection pool config? Error handling on connection loss?
- Memory cache — TTL handling? Race conditions on concurrent get/set?
- Key provider — secure key storage? Key rotation support?
- Virus scanner — what happens on scan failure? Does it fail open or closed?
- Encrypted storage — IV uniqueness? Correct cipher mode?
- Local storage — path traversal prevention? Symlink handling?
- System mailer — error handling? PII in email logs?

- [ ] **Step 1: Read all files listed above**
- [ ] **Step 2: Evaluate each file against all 7 review categories**
- [ ] **Step 3: Document findings using the Finding Format above**
- [ ] **Step 4: Return the complete findings list**

---

### Task 8: Consolidate findings report

**Depends on:** Tasks 1-7 (all must complete first)

**Output file:** `docs/superpowers/reports/2026-03-28-code-quality-findings.md`

- [ ] **Step 1: Collect findings from all 7 batch reviews**

- [ ] **Step 2: De-duplicate findings** — if multiple agents flagged the same issue (e.g., a shared utility used across domains), keep the most detailed version and note which domains it affects.

- [ ] **Step 3: Sort findings by severity** — Critical first, then High, Medium, Low. Within each severity, group by category.

- [ ] **Step 4: Write executive summary** — total count by severity and category in a table:

```markdown
## Executive Summary

| Severity | Count |
|----------|-------|
| Critical | N |
| High     | N |
| Medium   | N |
| Low      | N |

| Category | Count |
|----------|-------|
| Bugs | N |
| Race conditions | N |
| Error handling | N |
| Validation | N |
| State machine | N |
| Data integrity | N |
| Security | N |
```

- [ ] **Step 5: Write full report** with sections: Executive Summary → Critical → High → Medium → Low → Appendix (files reviewed per batch)

- [ ] **Step 6: Commit report**

```bash
git add docs/superpowers/reports/2026-03-28-code-quality-findings.md
git commit -m "docs: code quality review findings report"
```

- [ ] **Step 7: Present findings to user for triage** — summarise the critical and high findings, ask which to proceed with fixing.
