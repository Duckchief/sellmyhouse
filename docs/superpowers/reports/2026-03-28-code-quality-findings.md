# Code Quality Review — Findings Report

**Date:** 2026-03-28
**Scope:** Full codebase — 17 domains + infra (~160 source files, ~30k lines)
**Threshold:** Aggressive (>=50% likely real issue)

---

## Executive Summary

| Severity | Count |
|----------|-------|
| Critical | 1 |
| High | 18 |
| Medium | 51 |
| Low | 47 |
| **Total** | **117** |

| Category | Count |
|----------|-------|
| Race conditions | 22 |
| Security | 24 |
| Bugs | 24 |
| Validation | 18 |
| Data integrity | 14 |
| Error handling | 17 |
| State machine | 8 |

**Top priorities:**
1. External notifications broken — providers receive CUID IDs instead of email/phone (Critical)
2. 14 race conditions with TOCTOU patterns across transaction, offer, auth, seller, property, viewing domains
3. Multiple non-atomic multi-write operations risk data inconsistency (consent, transactions, properties)
4. Session fixation on all login paths — no session regeneration
5. Missing authorization on case flags and AI analysis endpoints
6. PDPA risk — account deletion may not delete encrypted files correctly

---

## Critical

### C1. External notifications receive CUID instead of email/phone — all external sends likely fail
- **File:** src/domains/notification/notification.service.ts:184
- **Category:** Bugs
- **Severity:** Critical
- **Description:** `sendExternal` passes `input.recipientId` (a CUID like `clxyz123...`) directly to `provider.send()`. EmailProvider uses it as the `to` address; WhatsAppProvider uses it as the phone number. Neither provider resolves actual contact info from the database. All external notifications (email and WhatsApp) will fail or send to invalid addresses.
- **Suggested fix:** Resolve the recipient's email/phone from the seller/agent/viewer record before calling `provider.send()`. The `SendNotificationInput` type already has optional `recipientPhone` and `recipientEmail` fields — populate them from the DB.

---

## High

### H1. No session regeneration on login (session fixation)
- **File:** src/domains/auth/auth.login.router.ts:77,131 | auth.setup-account.router.ts:110 | auth.registration.router.ts:72
- **Category:** Security
- **Severity:** High
- **Description:** After successful authentication, `req.logIn()` is called but `req.session.regenerate()` is never called. Tests assert regeneration, but production code does not do it. All four login paths (seller login, agent login, setup-account, registration) are affected. Attacker can set a known session ID cookie before victim logs in, then hijack the authenticated session.
- **Suggested fix:** Call `req.session.regenerate()` before `req.logIn()` on all login paths.

### H2. Concurrent registration creates duplicate sellers
- **File:** src/domains/auth/auth.service.ts:33-61
- **Category:** Race conditions
- **Severity:** High
- **Description:** `registerSeller` does check-then-act: queries `findSellerByEmail`, if no result, calls `createSeller`. Two concurrent requests with the same email both pass the check. Second will get a unique constraint violation (P2002) — unhandled, surfaces as 500.
- **Suggested fix:** Handle Prisma P2002 errors gracefully, or use upsert/advisory lock.

### H3. Password reset token retry logic flawed
- **File:** src/domains/auth/auth.login.router.ts:261-269
- **Category:** Security
- **Severity:** High
- **Description:** Reset-password handler tries seller role first. On `ValidationError`, retries with agent role using the same token. If the token is valid for seller but fails for another reason, it falls through to agent path incorrectly.
- **Suggested fix:** Look up both seller and agent by token first, determine which role matched, then perform reset for that specific role.

### H4. Transaction status advance without optimistic locking
- **File:** src/domains/transaction/transaction.service.ts:112-169
- **Category:** Race conditions
- **Severity:** High
- **Description:** `advanceTransactionStatus` reads status, validates transition, writes new status in separate DB calls. Two concurrent requests can both read and pass guards. No `WHERE status = currentStatus` guard on the update.
- **Suggested fix:** Use optimistic locking — include current status in the `WHERE` clause of the update, or use a serializable transaction.

### H5. Counter-offer creates child and updates parent non-atomically
- **File:** src/domains/offer/offer.service.ts:167-183
- **Category:** Race conditions / Data integrity
- **Severity:** High
- **Description:** `counterOffer` uses `Promise.all` for child creation and parent status update — two independent Prisma calls, not in a DB transaction. Failure of either leaves inconsistent state. Two agents can counter the same offer simultaneously.
- **Suggested fix:** Wrap in `prisma.$transaction` with optimistic lock on parent status.

### H6. markFallenThrough has no atomicity for status check + update
- **File:** src/domains/transaction/transaction.service.ts:210-255
- **Category:** Race conditions
- **Severity:** High
- **Description:** Same TOCTOU pattern as H4. Two concurrent requests both pass guard, both execute side effects (expire OTP, cancel viewings, send notifications) — side effects fire twice.
- **Suggested fix:** Add `WHERE status NOT IN ('completed', 'fallen_through')` to update, check affected rows, skip side effects if 0.

### H7. Consent withdrawal non-atomic — PDPA risk
- **File:** src/domains/compliance/compliance.service.ts:99-114
- **Category:** Race conditions
- **Severity:** High
- **Description:** `withdrawConsent` creates ConsentRecord and updates Seller's consent flag in two separate DB operations. Crash between them leaves consent record saying withdrawn but Seller row showing granted.
- **Suggested fix:** Wrap in `prisma.$transaction()`.

### H8. Grant marketing consent non-atomic
- **File:** src/domains/compliance/compliance.service.ts:200-225
- **Category:** Race conditions
- **Severity:** High
- **Description:** Same issue as H7. Creates ConsentRecord then updates Seller flag separately. Concurrent grants create duplicate records.
- **Suggested fix:** Wrap in `prisma.$transaction()`.

### H9. Document download-and-delete TOCTOU gap
- **File:** src/domains/seller/seller-document.service.ts:108-134
- **Category:** Race conditions
- **Severity:** High
- **Description:** `downloadAndDeleteSellerDocument` reads doc, decrypts, deletes file, marks row — not atomic. Two concurrent requests both read and process. Crash between file delete and DB update leaves inconsistent state.
- **Suggested fix:** Use `SELECT FOR UPDATE` or optimistic locking (check `deletedAt IS NULL` in WHERE).

### H10. Bulk download-and-delete iterates without locking
- **File:** src/domains/seller/seller-document.service.ts:136-163
- **Category:** Race conditions
- **Severity:** High
- **Description:** `downloadAllAndDeleteSellerDocuments` iterates docs one by one. Concurrent single-doc download races with bulk operation.
- **Suggested fix:** Atomically mark all documents as being processed before starting decryption/deletion.

### H11. Account delete uses localStorage but docs use encryptedStorage — PDPA risk
- **File:** src/domains/seller/account-delete.service.ts:35
- **Category:** Data integrity
- **Severity:** High
- **Description:** `deleteSellerAccount` calls `localStorage.delete()` for collected file paths, but seller documents are stored via `encryptedStorage.save()` (`.enc` files). If storage backends resolve paths differently, files may not actually be deleted, leaving PII on disk.
- **Suggested fix:** Use `encryptedStorage.delete()` for `.enc` files specifically.

### H12. Case flag status update has no authorization check
- **File:** src/domains/seller/case-flag.service.ts:32-51
- **Category:** Security
- **Severity:** High
- **Description:** `updateCaseFlag` accepts `input.agentId` but never verifies the agent is authorized. Any agent with a valid session can update any case flag.
- **Suggested fix:** Verify caller is the seller's assigned agent or an admin.

### H13. Case flag status transitions not validated
- **File:** src/domains/seller/case-flag.service.ts:32-51
- **Category:** State machine
- **Severity:** High
- **Description:** `updateCaseFlag` accepts any status value. No validation of valid transitions (e.g., `resolved` back to `identified` is allowed).
- **Suggested fix:** Define `STATUS_TRANSITIONS` map and validate before applying.

### H14. Duplicate lead submission race condition
- **File:** src/domains/lead/lead.service.ts:15-18
- **Category:** Race conditions
- **Severity:** High
- **Description:** `findActiveSellerByPhone` runs outside the `submitLeadAtomically` transaction. Two concurrent requests with same phone both pass check and create duplicate sellers.
- **Suggested fix:** Move duplicate check inside the transaction, or add partial unique index on `(phone, status)`.

### H15. Viewing cancellation decrement without row lock
- **File:** src/domains/viewing/viewing.service.ts:671-683
- **Category:** Race conditions
- **Severity:** High
- **Description:** `cancelViewing` reads `currentBookings`, decrements in application code, writes back. Two concurrent cancels both read same value, both write same decrement, losing one. Booking creation uses `FOR UPDATE` but cancellation does not.
- **Suggested fix:** Use Prisma `decrement` operation or wrap in transaction with `FOR UPDATE`.

### H16. Photo upload TOCTOU on duplicate check and max-photos check
- **File:** src/domains/property/photo.service.ts:82-91, 155-176
- **Category:** Race conditions
- **Severity:** High
- **Description:** `processAndSavePhoto` checks duplicates, then `addPhotoToListing` checks max photos — both are separate reads. Two concurrent uploads both pass both checks. Can exceed MAX_PHOTOS or create duplicates.
- **Suggested fix:** Serializable transaction or advisory lock on listing ID.

### H17. Price history append without transaction
- **File:** src/domains/property/property.repository.ts:53-79
- **Category:** Race conditions
- **Severity:** High
- **Description:** `appendPriceHistory` reads JSON, appends entry, writes back. Two concurrent updates overwrite each other — classic read-modify-write race.
- **Suggested fix:** Serializable transaction or restructure as separate table with simple inserts.

### H18. Testimonial content not sanitized (XSS)
- **File:** src/domains/content/content.service.ts:313-319 | testimonial.router.ts:52-57
- **Category:** Security
- **Severity:** High
- **Description:** Testimonial `content`, `clientName`, `clientTown` accepted from public unauthenticated users, stored as-is. No HTML sanitization. If Nunjucks renders with `| safe` or without autoescaping, this is stored XSS.
- **Suggested fix:** Sanitize (strip HTML tags) before storing. Add max length validation.

### H19. No concurrent execution guard for scheduled jobs
- **File:** src/infra/jobs/runner.ts:28-39
- **Category:** Race conditions
- **Severity:** High
- **Description:** Job runner has no mechanism to prevent overlapping executions. If a purge job takes longer than its cron interval, next invocation starts concurrently — double-processing records, racing on deletes, duplicate audit entries.
- **Suggested fix:** Add `running` flag per job, skip invocation if previous still in progress.

---

## Medium

### M1. 2FA bypass — agents without 2FA can access dashboard
- **File:** src/domains/auth/auth.login.router.ts:146-155 | src/infra/http/middleware/require-auth.ts:27-43
- **Category:** Security
- **Severity:** Medium
- **Description:** Agent without 2FA has `twoFactorEnabled=false`, so `requireTwoFactor` passes them through. Agent navigating directly to `/agent/dashboard` bypasses the setup redirect. Per spec, 2FA is mandatory for agents.
- **Suggested fix:** Block agents/admins with `twoFactorEnabled === false` in the guard, redirect to setup.

### M2. Seller creation and consent record not in a transaction
- **File:** src/domains/auth/auth.service.ts:54-70
- **Category:** Data integrity
- **Severity:** Medium
- **Description:** Two separate DB writes. Failure on consent record leaves orphaned seller without consent — PDPA compliance risk.
- **Suggested fix:** Wrap in `prisma.$transaction`.

### M3. Backup code removal not truly atomic
- **File:** src/domains/auth/auth.repository.ts:214-235 | auth.service.ts:350-375
- **Category:** Race conditions
- **Severity:** Medium
- **Description:** Read codes, bcrypt compare (slow), write filtered codes. Concurrent request can use same backup code before first write completes.
- **Suggested fix:** Optimistic locking or serializable transaction including the read.

### M4. forgotPasswordLimiter keys on untrusted email
- **File:** src/domains/auth/auth.login.router.ts:41
- **Category:** Security
- **Severity:** Medium
- **Description:** Rate limit key uses user-supplied email. Attacker varies casing/dots to bypass per-account limiting.
- **Suggested fix:** Normalize email (lowercase, trim) before keying. Combine IP + email.

### M5. resendAccountSetup blocks unverified sellers
- **File:** src/domains/auth/auth.service.ts:603
- **Category:** Bugs
- **Severity:** Medium
- **Description:** Throws `ValidationError('Seller email is not verified')` but setup email IS the mechanism to onboard unverified sellers. Guard blocks intended workflow.
- **Suggested fix:** Remove the `emailVerified` check for setup resends.

### M6. Inactive agent login skips lockout and timing differs
- **File:** src/domains/auth/auth.service.ts:157
- **Category:** Security
- **Severity:** Medium
- **Description:** Inactive agents return null immediately after bcrypt — no lockout tracking, no audit. Timing leak reveals inactive account existence. Brute-force not throttled.
- **Suggested fix:** Move `isActive` check after lockout/password validation logic.

### M7. Setup-account router accesses repository directly
- **File:** src/domains/auth/auth.setup-account.router.ts:6
- **Category:** Security
- **Severity:** Medium
- **Description:** Imports `authRepo` directly, duplicates bcrypt logic. Bypasses service-layer validation and audit.
- **Suggested fix:** Refactor to use `authService` methods.

### M8. Validation runs after status redirect in PATCH /status
- **File:** src/domains/transaction/transaction.router.ts:96-128
- **Category:** Validation
- **Severity:** Medium
- **Description:** `fallen_through` redirect check runs before `validationResult(req)`. Should validate first.
- **Suggested fix:** Move `validationResult` check first.

### M9. Counter-offer sets offerAmount to parent's amount
- **File:** src/domains/offer/offer.service.ts:178
- **Category:** Bugs
- **Severity:** Medium
- **Description:** Child counter-offer `offerAmount` is parent's original amount, not the counter value. If transaction uses `offer.offerAmount` as agreed price, wrong number used.
- **Suggested fix:** Clarify which field represents the agreed price. Ensure downstream consumers use the correct field.

### M10. No ownership check on AI analysis review/share
- **File:** src/domains/offer/offer.service.ts:284-353
- **Category:** Security
- **Severity:** Medium
- **Description:** `reviewAiAnalysis` and `shareAiAnalysis` skip `assertOfferOwnership`. Any authenticated agent can manipulate any offer's AI analysis.
- **Suggested fix:** Add ownership check.

### M11. agreedPrice not validated as numeric
- **File:** src/domains/transaction/transaction.validator.ts:4-9
- **Category:** Validation
- **Severity:** Medium
- **Description:** `agreedPrice` only checked `notEmpty()`. No decimal/numeric validation. `optionFee` not validated at all.
- **Suggested fix:** Add `.isDecimal()` or regex pattern.

### M12. OTP creation doesn't check transaction status
- **File:** src/domains/transaction/transaction.service.ts:314-336
- **Category:** State machine
- **Severity:** Medium
- **Description:** `createOtp` and `advanceOtp` don't verify transaction is in valid state. OTP can be created for completed/fallen_through transactions.
- **Suggested fix:** Add status guard.

### M13. Jobs silently abort batch on single notification failure
- **File:** src/domains/transaction/transaction.jobs.ts:26-59
- **Category:** Error handling
- **Severity:** Medium
- **Description:** If `notificationService.send` throws for one item, the entire `for` loop aborts. Remaining items unprocessed.
- **Suggested fix:** Wrap each iteration in try/catch, log, continue.

### M14. Template name mismatch in HDB appointment reminder dedup
- **File:** src/domains/transaction/transaction.jobs.ts:143-150
- **Category:** Bugs
- **Severity:** Medium
- **Description:** Dedup checks for `hdb_appointment_reminder` but notification sent as `generic`. Dedup never matches — reminders sent on every cron run.
- **Suggested fix:** Use consistent template name.

### M15. Post-completion messages use transaction ID instead of address
- **File:** src/domains/transaction/transaction.jobs.ts:98-99
- **Category:** Bugs
- **Severity:** Medium
- **Description:** `templateData.address` set to `tx.id` (a CUID) instead of actual property address. Same issue in OTP reminder at line 53.
- **Suggested fix:** Join property table or lookup address.

### M16. sellerId from request body used for notifications without verification
- **File:** src/domains/transaction/transaction.service.ts:210-255, 541-582
- **Category:** Security
- **Severity:** Medium
- **Description:** `markFallenThrough` and `sendInvoice` accept `sellerId` from request and send notifications to it. Not verified against `tx.sellerId`. Agent could trigger notification to arbitrary seller.
- **Suggested fix:** Use `tx.sellerId` from DB, not caller-supplied value.

### M17. Invoice status transitions not validated
- **File:** src/domains/transaction/transaction.service.ts:541-599
- **Category:** State machine
- **Severity:** Medium
- **Description:** `sendInvoice` and `markInvoicePaid` don't check current invoice status. Can skip states or go backwards.
- **Suggested fix:** Add status guards.

### M18. Consent withdrawal side effects non-atomic
- **File:** src/domains/compliance/compliance.service.ts:88-195
- **Category:** Data integrity
- **Severity:** Medium
- **Description:** Consent record + seller update + deletion request + side effects (void offers, cancel viewings, etc.) not in transaction. Partial failure leaves inconsistent state.
- **Suggested fix:** Wrap core DB writes in transaction. Accept side effects as best-effort with logging.

### M19. purgeTransactionSensitiveDocs runs without transaction
- **File:** src/domains/compliance/compliance.repository.ts:422-498
- **Category:** Data integrity
- **Severity:** Medium
- **Description:** Multiple Prisma operations across tables without transaction. Crash midway leaves partial purge.
- **Suggested fix:** Wrap in `prisma.$transaction()`.

### M20. hardDeleteSeller cascade without transaction
- **File:** src/domains/compliance/compliance.repository.ts:826-898
- **Category:** Data integrity
- **Severity:** Medium
- **Description:** 10+ cascading `deleteMany`/`delete` calls. Failure midway leaves orphaned records.
- **Suggested fix:** Wrap in `prisma.$transaction()`.

### M21. saveSaleProceeds buyerDeposit undefined on create
- **File:** src/domains/seller/seller.service.ts:643-660
- **Category:** Bugs
- **Severity:** Medium
- **Description:** On create path, `buyerDeposit: undefined` in spread may cause Prisma to skip field rather than default to 0.
- **Suggested fix:** Explicitly set `buyerDeposit: data.buyerDeposit ?? 0` in create clause.

### M22. Onboarding step 2 unsanitized property fields
- **File:** src/domains/seller/seller.router.ts:201-258
- **Category:** Validation
- **Severity:** Medium
- **Description:** `street`, `block`, `level`, `unitNumber`, `floorAreaSqm`, `leaseCommenceDate` from `req.body` with no sanitization or type validation.
- **Suggested fix:** Add express-validator rules for step 2 fields.

### M23. Onboarding step 3 parseFloat without NaN check
- **File:** src/domains/seller/seller.router.ts:261-295
- **Category:** Validation
- **Severity:** Medium
- **Description:** `parseFloat` on user input returns NaN for non-numeric strings. NaN passed to service/Prisma.
- **Suggested fix:** Validate with `isFinite()` or express-validator.

### M24. Seller router imports compliance repository directly
- **File:** src/domains/seller/seller.router.ts:24
- **Category:** Security
- **Severity:** Medium
- **Description:** Bypasses compliance service layer — violates architecture rules.
- **Suggested fix:** Use `complianceService` instead.

### M25. otpStatusGte/hdbStatusGte return true for unknown statuses
- **File:** src/domains/seller/seller.service.ts:222-235
- **Category:** Bugs
- **Severity:** Medium
- **Description:** `indexOf` returns -1 for unknown status. `-1 >= -1` is true — unknown statuses appear completed.
- **Suggested fix:** Return false if either index is -1.

### M26. checkInactiveSellers aborts batch on single failure
- **File:** src/domains/seller/seller.service.ts:596-627
- **Category:** Error handling
- **Severity:** Medium
- **Description:** One notification failure aborts entire loop. Same pattern as M13.
- **Suggested fix:** Per-item try/catch.

### M27. Compliance router assertInUploadsRoot — informational
- **File:** src/domains/compliance/compliance.router.ts:60-64
- **Category:** Security
- **Severity:** Medium
- **Description:** Path traversal check is actually correct upon inspection. Marking as informational — no action needed.

### M28. Lead PII in admin notification
- **File:** src/domains/lead/lead.service.ts:135
- **Category:** Security
- **Severity:** Medium
- **Description:** Admin notification includes full phone number in plain text. `maskPhone` imported but only used for audit log.
- **Suggested fix:** Use `maskPhone()` in notification template data.

### M29. Lead name/email no length limits
- **File:** src/domains/lead/lead.validator.ts:32-34
- **Category:** Validation
- **Severity:** Medium
- **Description:** Name and email fields have no maximum length. Megabytes of text accepted.
- **Suggested fix:** Add `isLength({ max: 200 })` for name, `isLength({ max: 254 })` for email.

### M30. sendSystemEmail failure breaks lead submission
- **File:** src/domains/lead/lead.service.ts:52-56
- **Category:** Error handling
- **Severity:** Medium
- **Description:** If email send throws, entire `submitLead` fails. But seller/consent already committed in prior transaction. User sees error, lead exists but no verification email.
- **Suggested fix:** Wrap email send in try/catch. Return success — seller can use resend flow.

### M31. cancelViewing doesn't use canTransitionViewing guard
- **File:** src/domains/viewing/viewing.service.ts:667-668
- **Category:** State machine
- **Severity:** Medium
- **Description:** Manual status check instead of state machine guard. Inconsistent with other operations.
- **Suggested fix:** Use `canTransitionViewing(v.status, 'cancelled')`.

### M32. Cancel token not matched to viewingId
- **File:** src/domains/viewing/viewing.service.ts:654-656
- **Category:** Security
- **Severity:** Medium
- **Description:** Receives both `viewingId` and `cancelToken`, looks up by token only, ignores viewingId. URL parameter creates false sense of validation.
- **Suggested fix:** Verify `viewing.id === viewingId` or remove viewingId parameter.

### M33. WhatsApp webhook timestamp unvalidated
- **File:** src/domains/notification/notification.service.ts:303-304
- **Category:** Error handling
- **Severity:** Medium
- **Description:** `parseInt(status.timestamp)` returns NaN for unexpected formats. `Invalid Date` written to DB.
- **Suggested fix:** Validate parsed timestamp.

### M34. JWT_SECRET not validated at startup for unsubscribe
- **File:** src/domains/notification/notification.service.ts:378
- **Category:** Security
- **Severity:** Medium
- **Description:** Non-null assertion `process.env.JWT_SECRET!`. If unset, confusing runtime error.
- **Suggested fix:** Validate at startup or use config helper.

### M35. DNC check not applied to viewers
- **File:** src/domains/notification/notification.service.ts:140-143
- **Category:** Security
- **Severity:** Medium
- **Description:** DNC gate only applies when `recipientType === 'seller'`. Viewer WhatsApp messages bypass DNC checks entirely.
- **Suggested fix:** Extend DNC to viewers, or document exemption rationale.

### M36. All WhatsApp templates pending — all falls back to email
- **File:** src/domains/notification/notification.templates.ts:130-160
- **Category:** Bugs
- **Severity:** Medium
- **Description:** Every entry in `WHATSAPP_TEMPLATE_STATUS` is `'pending'`. WhatsApp is never used as primary. Three-channel architecture is effectively two-channel.
- **Suggested fix:** Update status map when templates are approved by Meta. Log warning at startup.

### M37. Feedback prompt raw SQL timezone issue
- **File:** src/domains/viewing/viewing.repository.ts:533-544
- **Category:** Bugs
- **Severity:** Medium
- **Description:** `date + end_time::time` arithmetic uses implicit timezone. If DB stores UTC midnight, adding Singapore time creates wrong timestamp.
- **Suggested fix:** Use `AT TIME ZONE 'Asia/Singapore'` explicitly.

### M38. Recurring slot boundary clamping inconsistency
- **File:** src/domains/viewing/viewing.repository.ts:60-61
- **Category:** Bugs
- **Severity:** Medium
- **Description:** Clamping to 23:45 but validator constrains to 20:00. Inconsistent bounds.
- **Suggested fix:** Align clamp with validator or remove redundant clamp.

### M39. Property create + listing create not in transaction
- **File:** src/domains/property/property.service.ts:45-46
- **Category:** Data integrity
- **Severity:** Medium
- **Description:** Two separate creates. If second fails, orphaned property without listing.
- **Suggested fix:** Wrap in `prisma.$transaction()`.

### M40. Missing testimonial content length limit (public)
- **File:** src/domains/content/content.validator.ts:5
- **Category:** Validation
- **Severity:** Medium
- **Description:** Public `validateTestimonialSubmit` has no `isLength` constraint. Megabytes of text accepted. Manual testimonial validator correctly limits to 1000.
- **Suggested fix:** Add `.isLength({ min: 10, max: 1000 })`.

### M41. HDB sync filter may re-insert or prematurely exit
- **File:** src/domains/hdb/sync.service.ts:95-103
- **Category:** Bugs
- **Severity:** Medium
- **Description:** Filter uses `>=` including records from latest month already in DB. Early exit could skip newer records on edge cases.
- **Suggested fix:** Use `>` for strict comparison. Rely on `skipDuplicates` only for boundary month.

### M42. 1 ROOM flat type missing from resale levy table
- **File:** src/domains/property/resale-levy.ts:9-16
- **Category:** Bugs
- **Severity:** Medium
- **Description:** `SUBSIDISED_LEVY` omits `1 ROOM` but `HDB_FLAT_TYPES` includes it. Returns 0 levy instead of correct amount.
- **Suggested fix:** Add 1 ROOM levy from HDB's published rates.

### M43. Financial estimate no numeric validation
- **File:** src/domains/property/financial.router.ts:129-191
- **Category:** Validation
- **Severity:** Medium
- **Description:** `parseFloat()` on raw body values without NaN check. NaN propagates into calculations and DB.
- **Suggested fix:** Add `isNaN()` checks after `parseFloat()`.

### M44. Photo download-then-delete can lose data on stream error
- **File:** src/domains/property/portal.router.ts:80-113
- **Category:** Error handling
- **Severity:** Medium
- **Description:** ZIP streaming starts, then photos deleted. If stream fails partway, photos are lost and download incomplete.
- **Suggested fix:** Only delete after confirming successful stream completion.

### M45. Referral click count transition race
- **File:** src/domains/content/content.service.ts:477-483
- **Category:** Race conditions
- **Severity:** Medium
- **Description:** Increment atomic but status transition based on `clickCount === 1` check. Minor race window.
- **Suggested fix:** Combine increment + status transition in single atomic update.

### M46. Listing + property status update not transactional
- **File:** src/domains/property/property.service.ts:199-204
- **Category:** Data integrity
- **Severity:** Medium
- **Description:** Listing status and property status updated separately. Failure on second leaves inconsistent state.
- **Suggested fix:** Wrap in transaction.

### M47. Portal formatter parses photos as string[] but they're PhotoRecord[]
- **File:** src/domains/property/portal.formatter.ts:52-57
- **Category:** Bugs
- **Severity:** Medium
- **Description:** `JSON.parse(listing.photos)` cast as `string[]` but actual data is `PhotoRecord[]`. Downstream gets `[object Object]`.
- **Suggested fix:** Parse as `PhotoRecord[]` and extract paths.

### M48. AI description saved to description field — bypasses human-in-the-loop
- **File:** src/domains/property/property.service.ts:245-253
- **Category:** State machine
- **Severity:** Medium
- **Description:** `generateListingDescription` saves AI text to both `aiDescription` AND `description` simultaneously. Any code reading `description` without checking status serves unreviewed AI content.
- **Suggested fix:** Only populate `description` on explicit agent approval.

### M49. legalFeesEstimate not validated for negative values
- **File:** src/domains/property/financial.validator.ts:75-78
- **Category:** Validation
- **Severity:** Medium
- **Description:** No check for negative values. `-10000` legal fees inflates net proceeds.
- **Suggested fix:** Add range check `>= 0`.

### M50. Description draft doesn't update aiDescriptionStatus
- **File:** src/domains/property/property.repository.ts:163-170
- **Category:** State machine
- **Severity:** Medium
- **Description:** Saving draft updates text but not status. Status remains `ai_generated` after manual edit.
- **Suggested fix:** Set status to `pending_review` on draft save.

### M51. CSV injection in audit log export
- **File:** src/domains/admin/admin.router.ts:152-158
- **Category:** Security
- **Severity:** Medium
- **Description:** Audit log CSV writes fields directly. Values starting with `=`, `+`, `-`, `@` trigger Excel formula injection.
- **Suggested fix:** Prefix formula-triggering characters with `'` or use proper CSV library.

### M52. Bulk assign fetches only first page of sellers
- **File:** src/domains/admin/admin.router.ts:558
- **Category:** Bugs
- **Severity:** Medium
- **Description:** `getAllSellers({})` defaults to 25 per page. Sellers beyond page 1 treated as having no agent.
- **Suggested fix:** Pass specific IDs or adequate limit.

### M53. Maintenance message/ETA no sanitization
- **File:** src/domains/admin/admin.service.ts:513-536
- **Category:** Security
- **Severity:** Medium
- **Description:** Admin-set maintenance message stored and rendered without sanitization. XSS risk depends on Nunjucks autoescaping config.
- **Suggested fix:** Ensure autoescaping enabled in templates rendering these values.

### M54. Toggle maintenance mode TOCTOU
- **File:** src/domains/admin/admin.service.ts:497-511
- **Category:** Race conditions
- **Severity:** Medium
- **Description:** Read current value, write toggled value. Two concurrent requests can both read same value.
- **Suggested fix:** Atomic toggle with raw SQL or transaction with `SELECT FOR UPDATE`.

### M55. Agent settings decryption failure silently returns null
- **File:** src/domains/agent-settings/agent-settings.service.ts:44-49
- **Category:** Error handling
- **Severity:** Medium
- **Description:** Agent sees settings as unconfigured after key rotation. May overwrite working credentials.
- **Suggested fix:** Return `decryptionFailed: true` flag so UI shows meaningful message.

### M56. WhatsApp/SMTP test exposes error details
- **File:** src/domains/agent-settings/agent-settings.service.ts:72-73
- **Category:** Security
- **Severity:** Medium
- **Description:** Raw error messages from Facebook Graph API / nodemailer returned to client. May contain token fragments or internal URLs.
- **Suggested fix:** Return generic "Connection failed", log details server-side.

### M57. NRIC mask hardcodes 'S' prefix
- **File:** src/domains/shared/nric.ts:6-8
- **Category:** Bugs
- **Severity:** Medium
- **Description:** Always produces `SXXXX567A`. NRICs can start with S, T, F, G, M. Misleading for non-S-prefix.
- **Suggested fix:** Change to `XXXX${last4}`.

### M58. Public HDB API storeyRange not validated
- **File:** src/domains/public/public.router.ts:43
- **Category:** Validation
- **Severity:** Medium
- **Description:** `town` and `flatType` validated against allowlists but `storeyRange` passed unchecked.
- **Suggested fix:** Validate against known values or apply regex.

### M59. Anonymised agent sessions not invalidated
- **File:** src/domains/admin/admin.service.ts:192-213
- **Category:** Data integrity
- **Severity:** Medium
- **Description:** `anonymiseAgent` sets `isActive: false` but doesn't call `invalidateUserSessions`. Anonymised agent can use platform until session expires.
- **Suggested fix:** Add `authRepo.invalidateUserSessions(agentId)`.

### M60. Passport serializes full user object in session
- **File:** src/infra/http/middleware/passport.ts:66-67
- **Category:** Security
- **Severity:** Medium
- **Description:** PII (email, name, role) stored in cleartext JSON in session table. Changes to user attributes not reflected until re-login.
- **Suggested fix:** Serialize only ID + role. Deserialize from DB with short-TTL cache.

### M61. CSRF token not bound to session
- **File:** src/infra/http/middleware/csrf.ts:15
- **Category:** Security
- **Severity:** Medium
- **Description:** Empty string session identifier for all users. Tokens interchangeable across sessions.
- **Suggested fix:** Bind to session ID after authentication.

### M62. Local storage path traversal check doesn't handle symlinks
- **File:** src/infra/storage/local-storage.ts:7-12
- **Category:** Security
- **Severity:** Medium
- **Description:** `path.resolve` doesn't follow symlinks. Symlink inside uploads directory bypasses check.
- **Suggested fix:** Use `fs.realpath()` before comparison.

### M63. Encrypted storage doesn't zero data key from memory
- **File:** src/infra/storage/encrypted-storage.ts:34-49
- **Category:** Security
- **Severity:** Medium
- **Description:** Data key buffer persists in memory until GC. Exposed via memory dump.
- **Suggested fix:** `dataKey.fill(0)` after use.

### M64. Purge job partial failure handling
- **File:** src/infra/jobs/purge-sensitive-docs.job.ts:6-15
- **Category:** Data integrity
- **Severity:** Medium
- **Description:** If DB delete succeeds but `fs.unlink` fails, encrypted file orphaned on disk. No retry mechanism.
- **Suggested fix:** Per-record try/catch. Add orphan cleanup job.

### M65. Anonymise offers job lacks atomicity
- **File:** src/infra/jobs/anonymise-offers.job.ts:8-24
- **Category:** Data integrity
- **Severity:** Medium
- **Description:** Offer anonymisation and audit log not transactional. Audit can fail silently.
- **Suggested fix:** Wrap in `prisma.$transaction`.

### M66. Property+listing non-atomic (submitLeadDetails)
- **File:** src/domains/lead/verification.service.ts:37-51
- **Category:** Data integrity
- **Severity:** Medium
- **Description:** `submitLeadDetails` creates property and updates selling intent separately. First failure leaves orphan.
- **Suggested fix:** Wrap in `prisma.$transaction`.

---

## Low

### L1. setup2FA sets session timeout before 2FA confirmed
- **File:** src/domains/auth/auth.two-factor.router.ts:27-29
- **Category:** Bugs
- **Severity:** Low

### L2. Password reset no max length (bcrypt 72-byte truncation)
- **File:** src/domains/auth/auth.validator.ts:37-43
- **Category:** Validation
- **Severity:** Low

### L3. TOTP window may be 0 (fragile clock drift)
- **File:** src/domains/auth/auth.service.ts:259,310
- **Category:** Bugs
- **Severity:** Low

### L4. Lockout error surfaces as generic error page
- **File:** src/domains/auth/auth.service.ts:107
- **Category:** Error handling
- **Severity:** Low

### L5. Agent case flag/status routes don't verify seller ownership
- **File:** src/domains/agent/agent.router.ts:356-409
- **Category:** Security
- **Severity:** Low

### L6. No max length on backup code input (bcrypt DoS)
- **File:** src/domains/auth/auth.validator.ts:29-31
- **Category:** Validation
- **Severity:** Low

### L7. Agent pagination: page > totalPages when empty
- **File:** src/domains/agent/agent.service.ts:184
- **Category:** Bugs
- **Severity:** Low

### L8. shareAiAnalysis hardcoded placeholder address
- **File:** src/domains/offer/offer.service.ts:337
- **Category:** Bugs
- **Severity:** Low

### L9. HDB application status transitions not validated
- **File:** src/domains/transaction/transaction.service.ts:257-310
- **Category:** State machine
- **Severity:** Low

### L10. offerAmount type inconsistency (string vs number)
- **File:** src/domains/offer/offer.router.ts:71
- **Category:** Validation
- **Severity:** Low

### L11. No length/sanitization on notes fields
- **File:** src/domains/offer/offer.validator.ts:1-28
- **Category:** Validation
- **Severity:** Low

### L12. Unused localStorage import in transaction router
- **File:** src/domains/transaction/transaction.router.ts:17
- **Category:** Bugs
- **Severity:** Low

### L13. notApplicable milestones shown as 'upcoming'
- **File:** src/domains/seller/seller.service.ts:439-441
- **Category:** Bugs
- **Severity:** Low

### L14. recordCpfDisclaimerShown no existence check
- **File:** src/domains/seller/seller.service.ts:629-637
- **Category:** Error handling
- **Severity:** Low

### L15. Document delete redundant double lookup
- **File:** src/domains/seller/seller.router.ts:480-519
- **Category:** Validation
- **Severity:** Low

### L16. Correction request nricLast4 not auto-applied
- **File:** src/domains/compliance/compliance.validator.ts:31
- **Category:** Validation
- **Severity:** Low

### L17. findCddRecordsByTransaction misses counterparty CDD
- **File:** src/domains/compliance/compliance.repository.ts:1052-1062
- **Category:** Bugs
- **Severity:** Low

### L18. CDD upload stores client mimeType instead of detected
- **File:** src/domains/compliance/compliance.service.ts:1322
- **Category:** Security
- **Severity:** Low

### L19. Seller document upload correctly uses detected mime (inconsistency with CDD)
- **File:** src/domains/seller/seller-document.service.ts:74
- **Category:** Security
- **Severity:** Low

### L20. Slug collision possible on concurrent requests
- **File:** src/domains/property/property.service.ts:22-26
- **Category:** Race conditions
- **Severity:** Low

### L21. Audit log fire-and-forget without catch (property)
- **File:** src/domains/property/property.service.ts:48-53
- **Category:** Error handling
- **Severity:** Low

### L22. askingPrice allows zero
- **File:** src/domains/property/property.validator.ts:31
- **Category:** Validation
- **Severity:** Low

### L23. reorderPhotos silently drops photos not in ID array
- **File:** src/domains/property/photo.service.ts:237-239
- **Category:** Bugs
- **Severity:** Low

### L24. No upper bound on sale price / outstanding loan
- **File:** src/domains/property/financial.validator.ts:37-43
- **Category:** Validation
- **Severity:** Low

### L25. Content jobs swallow errors in referral completion
- **File:** src/domains/content/content.jobs.ts:49-51
- **Category:** Error handling
- **Severity:** Low

### L26. photosDownloaded heuristic unreliable
- **File:** src/domains/property/photo.service.ts:262-266
- **Category:** Bugs
- **Severity:** Low

### L27. Buyer deposit max hardcoded at $5,000
- **File:** src/domains/property/financial.router.ts:157
- **Category:** Validation
- **Severity:** Low

### L28. Market content schedule loaded but not applied
- **File:** src/domains/content/content.jobs.ts:35-37
- **Category:** Bugs
- **Severity:** Low

### L29. Phone masking reveals 4-char phones in full
- **File:** src/domains/shared/nric.ts:30-31
- **Category:** Bugs
- **Severity:** Low

### L30. Audit export no size limit
- **File:** src/domains/shared/audit.repository.ts:74-82
- **Category:** Error handling
- **Severity:** Low

### L31. Settings service sequential reads for commission
- **File:** src/domains/shared/settings.service.ts:39-50
- **Category:** Race conditions
- **Severity:** Low

### L32. Admin date filters accept arbitrary strings
- **File:** src/domains/admin/admin.router.ts:142-143
- **Category:** Validation
- **Severity:** Low

### L33. Profile password change no max length
- **File:** src/domains/profile/profile.service.ts:95-123
- **Category:** Validation
- **Severity:** Low

### L34. No password complexity requirements (profile)
- **File:** src/domains/profile/profile.service.ts:106
- **Category:** Validation
- **Severity:** Low

### L35. commission_total_with_gst setting key not in SETTING_KEYS
- **File:** src/domains/admin/admin.service.ts:623
- **Category:** Bugs
- **Severity:** Low

### L36. AI facade no prompt length validation
- **File:** src/domains/shared/ai/ai.facade.ts:83-142
- **Category:** Security
- **Severity:** Low

### L37. Avatar path traversal uses CWD-relative resolve
- **File:** src/domains/profile/profile.service.ts:14
- **Category:** Security
- **Severity:** Low

### L38. Email mask reveals single-char local parts
- **File:** src/domains/shared/nric.ts:38-41
- **Category:** Bugs
- **Severity:** Low

### L39. Listing rejection clears data but unused params
- **File:** src/domains/review/review.repository.ts:222-252
- **Category:** Data integrity
- **Severity:** Low

### L40. Booking form Singapore-only phone
- **File:** src/domains/viewing/viewing.validator.ts:201-203
- **Category:** Validation
- **Severity:** Low

### L41. Bulk slot creation skips overlap check
- **File:** src/domains/viewing/viewing.service.ts:102-176
- **Category:** Validation
- **Severity:** Low

### L42. Viewing job notification loops lack per-item error boundaries
- **File:** src/domains/viewing/viewing.service.ts:785-919
- **Category:** Error handling
- **Severity:** Low

### L43. countBookingsToday uses server timezone not SGT
- **File:** src/domains/viewing/viewing.repository.ts:384-396
- **Category:** Bugs
- **Severity:** Low

### L44. Webhook validator too permissive
- **File:** src/domains/notification/notification.validator.ts:3
- **Category:** Validation
- **Severity:** Low

### L45. No CSRF on unsubscribe POST
- **File:** src/domains/notification/notification.router.ts:113-142
- **Category:** Security
- **Severity:** Low

### L46. getMonthSlotMeta date boundary edge case
- **File:** src/domains/viewing/viewing.service.ts:1065
- **Category:** Bugs
- **Severity:** Low

### L47. formatMonth filter can return undefined
- **File:** src/infra/http/app.ts:97-98
- **Category:** Bugs
- **Severity:** Low

### L48. apiRateLimiter only applies to /api prefix
- **File:** src/infra/http/app.ts:213
- **Category:** Validation
- **Severity:** Low

### L49. resendVerificationRateLimiter can rate-limit arbitrary emails
- **File:** src/infra/http/middleware/rate-limit.ts:68
- **Category:** Bugs
- **Severity:** Low

### L50. AWS KMS key provider swallows original error
- **File:** src/infra/security/key-provider-aws.ts:28-29
- **Category:** Error handling
- **Severity:** Low

### L51. Virus scanner logs filenames with potential PII
- **File:** src/infra/security/virus-scanner.ts:54,66,74
- **Category:** Security
- **Severity:** Low

### L52. Session cookie secure flag inconsistent with CSRF check
- **File:** src/infra/http/middleware/session.ts:23
- **Category:** Security
- **Severity:** Low

### L53. requireRole does not verify 2FA completion
- **File:** src/infra/http/middleware/require-auth.ts:14-25
- **Category:** Security
- **Severity:** Low

### L54. MemoryCache no maximum size limit
- **File:** src/infra/cache/memory-cache.ts:1-27
- **Category:** Bugs
- **Severity:** Low

### L55. System mailer creates new transport per call
- **File:** src/infra/email/system-mailer.ts:26-31
- **Category:** Bugs
- **Severity:** Low

### L56. Prisma client no shutdown hook
- **File:** src/infra/database/prisma.ts:1-19
- **Category:** Error handling
- **Severity:** Low

### L57. Maintenance middleware fetches message/ETA without caching
- **File:** src/infra/http/middleware/maintenance.ts:47-48
- **Category:** Bugs
- **Severity:** Low

---

## Appendix: Files Reviewed Per Batch

**Batch 1 — auth, agent (14 files):** auth.service, auth.repository, auth.router, auth.login.router, auth.registration.router, auth.setup-account.router, auth.two-factor.router, auth.types, auth.validator, agent.service, agent.repository, agent.router, agent.types, agent.validator

**Batch 2 — transaction, offer (11 files):** transaction.service, transaction.repository, transaction.router, transaction.types, transaction.validator, transaction.jobs, offer.service, offer.repository, offer.router, offer.types, offer.validator

**Batch 3 — seller, compliance (18 files):** seller.service, seller.repository, seller.router, seller.types, seller.validator, seller-document.service, seller-document.repository, seller-document.validator, account-delete.service, case-flag.service, case-flag.repository, case-flag.types, case-flag.validator, compliance.service, compliance.repository, compliance.router, compliance.types, compliance.validator

**Batch 4 — lead, viewing, notification (24 files):** lead.service, lead.repository, lead.router, lead.types, lead.validator, verification.service, verification.router, verification.types, viewing.service, viewing.repository, viewing.router, viewing.types, viewing.validator, viewing.jobs, recurring.utils, notification.service, notification.repository, notification.router, notification.types, notification.validator, notification.templates, email.provider, in-app.provider, whatsapp.provider

**Batch 5 — property, hdb, content (26 files):** property.service, property.repository, property.router, property.types, property.validator, financial.calculator, financial.service, financial.repository, financial.router, financial.types, financial.validator, photo.service, portal.formatter, portal.repository, portal.service, portal.router, resale-levy, hdb/service, hdb/repository, hdb/sync.service, hdb/types, content.service, content.repository, content.types, content.validator, content.jobs, testimonial.router

**Batch 6 — admin, profile, agent-settings, public, review, shared (32 files):** admin.service, admin.repository, admin.router, admin.types, admin.validator, profile.service, profile.repository, profile.router, profile.types, profile.multer, agent-settings.service, agent-settings.repository, agent-settings.router, agent-settings.types, agent-settings.validator, public.router, review.service, review.repository, review.router, review.types, review.validator, errors, encryption, nric, audit.service, audit.repository, audit.types, settings.service, settings.repository, settings.types, ai.facade, ai.types

**Batch 7 — infra (28 files):** app, health.router, session.d, require-auth, error-handler, session, passport, csrf, rate-limit, maintenance, request-logger, referral-tracking, portals-badge, date.filter, purge-sensitive-docs.job, anonymise-offers.job, retention.job, runner, prisma, memory-cache, key-provider, key-provider-aws, virus-scanner, storage.types, encrypted-storage, local-storage, system-mailer, logger
