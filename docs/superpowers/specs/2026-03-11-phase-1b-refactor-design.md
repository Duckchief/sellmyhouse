# Phase 1B Refactor — Design Spec

**Date:** 2026-03-11
**Status:** Approved
**Scope:** Full refactor of auth, notification, and agent-settings domains

## Context

Phase 1B (auth, notification, agent-settings) was built without a design spec or implementation plan. This refactor applies the Superpowers workflow retroactively: fix critical blockers, close compliance gaps, improve test coverage, and bring code quality in line with the rest of the codebase.

**Approach:** Fix-in-place. The existing code is structurally sound (proper layering, typed errors, repository pattern). Issues are mostly missing features and missing tests, not bad architecture.

---

## 1. Auth Domain Refactor

### 1.1 Critical Fixes

**Agent 2FA enforcement:**
- Add middleware that checks `twoFactorEnabled` on agent/admin login
- If not enabled, redirect to `/auth/2fa/setup` and block all other agent/admin routes
- Apply `requireTwoFactor()` to all agent/admin route groups
- Agent cannot access any dashboard page until 2FA is configured

**Password reset flow (email token-based):**
- `POST /auth/forgot-password` — accepts email, generates cryptographically random token (64 bytes hex via `crypto.randomBytes`), stores SHA-256 hash in DB with 1-hour expiry, emails reset link via notification service
- `GET /auth/reset-password/:token` — renders reset form
- `POST /auth/reset-password/:token` — hashes incoming token with SHA-256, compares against stored hash, updates password, invalidates all other sessions, audit logs the reset
- Token hashing uses SHA-256 (not bcrypt — single-use token with short expiry, constant-time comparison via `crypto.timingSafeEqual`)
- New schema fields on Seller and Agent: `passwordResetToken` (String, nullable, SHA-256 hashed), `passwordResetExpiry` (DateTime, nullable)
- Rate limit: 3 reset requests per email per hour

**Email enumeration prevention:**
- Login endpoints return identical error messages regardless of whether email exists
- Always run `bcrypt.compare` against a dummy hash when user not found (constant-time response)
- Same response shape and timing for "wrong email" and "wrong password"

**Backup code race condition:**
- Wrap backup code verification in `prisma.$transaction` with `SELECT FOR UPDATE` row locking
- Prevents duplicate usage under concurrent requests

**Session invalidation on password change:**
- Both password reset (via token) and normal password change (via settings) must invalidate all other sessions for that user
- Delete all rows from the sessions table matching the user's session data
- The current session (the one making the change) remains active

**2FA session timeout differentiation:**
- When 2FA is enabled and verified, set session cookie `maxAge` to 30 minutes
- When 2FA is not enabled (sellers without 2FA), set `maxAge` to 24 hours
- Apply this at login time based on user's `twoFactorEnabled` status
- On 2FA setup completion, update the current session's timeout to 30 minutes

**Distinguish login lockout vs 2FA lockout:**
- Failed login (wrong password): 5 failures → 30-minute auto-unlock via `loginLockedUntil`. Counter resets on successful login.
- Failed 2FA (wrong TOTP): 5 failures → requires password reset to unlock (existing `twoFactorLockedUntil` behavior per Phase 1 requirements). This is intentionally stricter because 2FA protects higher-privilege operations.
- These are separate counters with separate fields and separate unlock mechanisms.

**Auth audit event names (explicit list):**
- `auth.seller_registered` — seller registration
- `auth.login_success` — successful login (seller or agent)
- `auth.login_failed` — failed login attempt (wrong password)
- `auth.login_locked` — account locked after 5 failed login attempts
- `auth.2fa_setup` — 2FA enabled
- `auth.2fa_verified` — successful 2FA verification
- `auth.2fa_failed` — failed 2FA attempt
- `auth.2fa_locked` — account locked after 5 failed 2FA attempts
- `auth.2fa_backup_used` — backup code used for login
- `auth.password_changed` — password changed via settings
- `auth.password_reset_requested` — password reset email sent
- `auth.password_reset_completed` — password successfully reset via token
- `auth.logout` — user logged out

### 1.2 Code Quality Improvements

**Split router (auth.router.ts → 4 files):**
- `auth.router.ts` — main router, mounts sub-routers
- `auth.registration.router.ts` — `POST /auth/register`, `GET /auth/register`
- `auth.login.router.ts` — `POST /auth/login/seller`, `POST /auth/login/agent`, `POST /auth/logout`, `GET /auth/login`
- `auth.two-factor.router.ts` — `GET/POST /auth/2fa/setup`, `GET/POST /auth/2fa/verify`, `POST /auth/2fa/backup`
- Password reset endpoints go in `auth.login.router.ts`

**Failed login tracking:**
- Mirror the 2FA lockout pattern with DB-level tracking
- New fields on Seller and Agent: `failedLoginAttempts` (Int, default 0), `loginLockedUntil` (DateTime, nullable)
- Lock after 5 failures for 30 minutes
- Reset counter on successful login
- Audit log `auth.login_locked` when account is locked

### 1.3 Test Additions

- Agent login flow (success, inactive agent, wrong password)
- Agent 2FA enforcement (redirect to setup, block dashboard access)
- Password reset flow (request, invalid token, expired token, success, session invalidation)
- Session invalidation on password change via settings (all other sessions destroyed)
- 2FA session timeout (30min for 2FA users, 24hr for non-2FA)
- Login lockout vs 2FA lockout (separate counters, different unlock mechanisms)
- RBAC enforcement (seller cannot access agent routes, agent cannot access admin routes)
- HTMX response headers (HX-Redirect set correctly on login/register)
- Email enumeration prevention (identical responses for existing/non-existing emails)
- Backup code race condition (concurrent usage returns one success, one failure)
- Failed login lockout (locks after 5 failures, unlocks after 30 min)
- All audit events verified (explicit check that each event in the audit event list is logged)

---

## 2. Notification Domain Refactor

### 2.1 Critical Compliance Fixes

**Notification preference check:**
- Before sending any notification, look up seller's `notificationPreference` field
- If `email_only`, skip WhatsApp entirely — send via email
- If `whatsapp_and_email` (default), use WhatsApp primary with email fallback
- Add `resolveChannel(recipientId, recipientType)` method that queries preference and returns a `NotificationChannel` (`'whatsapp' | 'email'`) representing the primary channel to use
- Agent notifications always use both channels (agents don't have a preference setting)

**Marketing consent enforcement:**
- Add `notificationType` field to `SendNotificationInput`: `'transactional' | 'marketing'`
- Marketing notifications check `seller.consentMarketing` — blocked and logged if false
- Transactional notifications only require active service consent
- Log blocked marketing attempts to audit trail: `notification.marketing_blocked`

**Webhook signature verification:**
- Configure Express to capture raw body on webhook route: `express.json({ verify: (req, _res, buf) => { (req as any).rawBody = buf; } })`
- Apply this custom parser only to the webhook route (not globally)
- Verify HMAC-SHA256 signature using `crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')`
- Reject requests with invalid or missing signatures (401 response)

**DNC registry check:**
- Before sending any WhatsApp message, check the recipient's phone number against the Singapore DNC registry
- If the number is on the DNC registry AND no valid consent exception applies (service consent counts as an exception for transactional messages), block the send and fall back to email
- Log DNC blocks: `notification.dnc_blocked` with phone (last 4 digits only) and template
- DNC check is a separate service call — stub the implementation for now (actual DNC API integration is a future task), but wire the check into the notification flow so it's enforced once the DNC service is implemented
- Add `DncCheckResult` type: `{ blocked: boolean; reason?: string }`

**Audit logging:**
- Log all notification sends: `notification.sent` with channel, template, recipientType, recipientId
- Log all failures: `notification.failed` with error details
- Log all fallbacks: `notification.fallback` when WhatsApp fails and email is used
- Log marketing blocks: `notification.marketing_blocked`
- Log DNC blocks: `notification.dnc_blocked`

**Agent alert on total channel failure:**
- If both WhatsApp and email fail for a notification, the in-app notification is still delivered to the recipient
- Additionally, send an in-app notification to the assigned agent: "Communication failure: unable to reach [seller name] via WhatsApp or email for [template name]. Please follow up manually."
- Log: `notification.all_channels_failed`

### 2.2 Missing Features

**HTML email templates:**
- Create Nunjucks email templates in `src/views/emails/` for each notification type
- Base email layout: `src/views/emails/base.njk` with header (logo, brand colors), content block, footer (unsubscribe link, contact info)
- Email provider renders Nunjucks template before sending
- Template variables passed through from notification service

**Unsubscribe links:**
- Marketing emails include unsubscribe link: `/api/notifications/unsubscribe?token=<jwt>`
- JWT signed with `SESSION_SECRET` from `.env` (not the encryption key — SESSION_SECRET is already used for session signing and is appropriate for URL tokens)
- JWT contains sellerId and purpose (marketing consent withdrawal), expires in 30 days
- Handler: update `seller.consentMarketing` to `false` AND create new ConsentRecord (append-only) with `purposeMarketing: false` and `consentWithdrawnAt` timestamp
- Both the Seller model update and ConsentRecord creation must happen atomically in a single Prisma transaction
- Redirect to confirmation page (no auth required — the JWT is the authorization)
- Audit log: `consent.marketing_withdrawn`

**Email attachments:**
- Extend `ChannelProvider.send()` interface to accept optional `attachments` array
- Each attachment: `{ filename: string; content: Buffer; contentType: string }`
- `EmailProvider` passes attachments to Nodemailer's `attachments` option
- WhatsApp provider ignores attachments (WhatsApp Business API document sending is separate)

**Template approval status:**
- Add `WHATSAPP_TEMPLATE_STATUS` map in `notification.templates.ts`
- Each template has status: `approved | pending | suspended`
- Service checks status before sending via WhatsApp
- If template not approved, automatically fall back to email and log the fallback
- Admin can update template status via SystemSetting (future — not in this refactor)

**Email retry logic:**
- Match WhatsApp's retry pattern: 3 attempts with exponential backoff (1s → 2s → 4s)
- Retries happen synchronously within the `send()` call (max ~7s total). This is acceptable because notification sends are fire-and-forget from the caller's perspective — the caller does not await the result. If a caller needs async behavior, they can call `send()` without awaiting.
- Apply to both primary email sends and fallback email sends
- After 3 failed retries, mark notification as `failed` and log error

### 2.3 Code Quality

**Extract templates:**
- Move 21 inline templates from `notification.service.ts` to `notification.templates.ts`
- Export as typed constant: `NOTIFICATION_TEMPLATES: Record<NotificationTemplateName, { subject: string; body: string }>`
- Template interpolation stays in service (simple `{{key}}` replacement)

**Add validator:**
- Create `notification.validator.ts`
- Webhook payload validation: `body.entry` must be array, `entry[].changes[].value.statuses` must be array of objects with `id`, `status`, `recipient_id`
- Notification input validation: `recipientId` non-empty string, `templateName` must be in `NotificationTemplateName` enum, `channel` must be valid `NotificationChannel` if provided, `notificationType` must be `'transactional' | 'marketing'`

**Use InAppProvider consistently:**
- Wire up existing `in-app.provider.ts` through the provider dispatch logic
- Remove duplicated in-app logic from service

### 2.4 Test Additions

Tests extend existing test files where they exist; new test files created for new modules.

- Notification preference enforcement (email_only skips WhatsApp, whatsapp_and_email uses both)
- Marketing consent enforcement (blocked without consent, allowed with consent)
- DNC registry check (blocked number falls back to email, allowed number sends WhatsApp)
- Webhook signature verification (valid signature accepted, invalid rejected)
- Audit logging (sent, failed, fallback, marketing_blocked, dnc_blocked all logged)
- Agent alert on total channel failure (both channels fail → agent notified)
- Email template rendering (correct template selected, variables interpolated)
- Unsubscribe flow (valid token withdraws consent and updates seller, expired token rejected, invalid token rejected)
- Email retry logic (retries 3 times, fails after exhausting retries)
- Template approval status (unapproved template falls back to email)
- Email attachments (passed through to Nodemailer correctly)
- Integration tests for full notification flow (service → provider → repository)

---

## 3. Agent-Settings Domain Refactor

### 3.1 Fixes

**Add validator:**
- Create `agent-settings.validator.ts` with express-validator schemas
- WhatsApp credentials: all three fields required when saving, max length 500 chars
- SMTP credentials: host required, port required and numeric (1-65535), user/pass required, from_email must be valid email, from_name max 100 chars
- Apply validators to POST routes

**Fix redundant HTMX rendering:**
- GET endpoint: HTMX requests return `partials/agent/settings` fragment, normal requests return full page `pages/agent/settings`
- Currently both branches render the same full page template

**Fix repository:**
- Change `deleteMany` to `delete` using `@@unique([agentId, key])` constraint (already exists in schema — verify before implementing; if missing, add migration)
- More semantically correct for single-record operations

**Add null-safety:**
- Wrap `decrypt()` calls in try-catch
- If decryption fails (corrupted data), return null and log warning
- Don't crash the settings page if one value is corrupted

**Improve error logging:**
- Log failed connection tests to audit trail: `agent_settings.test_failed`
- Include which channel (WhatsApp/SMTP) and sanitized error message (no credentials in logs)

### 3.2 Tests

**Router tests:**
- GET /agent/settings — returns settings page (auth required, agent role)
- POST /agent/settings/whatsapp — saves encrypted credentials (validation, success, auth)
- POST /agent/settings/email — saves encrypted credentials (validation, success, auth)
- POST /agent/settings/test/whatsapp — connection test (success, failure, missing config)
- POST /agent/settings/test/email — connection test (success, failure, missing config)
- HTMX fragment responses verified

**Repository tests:**
- Upsert creates and updates correctly
- Find returns decryptable values
- Delete removes single record

**Error scenario tests:**
- Missing credentials returns validation error
- Invalid SMTP port rejected
- Corrupted encrypted value handled gracefully
- Network timeout on connection test returns failure message

---

## 4. Schema Changes Summary

New fields added to Prisma schema:

```
Agent:
  + passwordResetToken    String?
  + passwordResetExpiry   DateTime?
  + failedLoginAttempts   Int       @default(0)
  + loginLockedUntil      DateTime?

Seller:
  + passwordResetToken    String?
  + passwordResetExpiry   DateTime?
  + failedLoginAttempts   Int       @default(0)
  + loginLockedUntil      DateTime?
```

No new models. No changes to existing field types.

---

## 5. File Changes Summary

### Auth Domain
- **Modified:** `auth.types.ts` (add password reset types)
- **Modified:** `auth.service.ts` (add password reset, email enumeration fix, login lockout, backup code transaction)
- **Modified:** `auth.repository.ts` (add password reset token CRUD, login attempt tracking)
- **Modified:** `auth.validator.ts` (add password reset validators)
- **Replaced:** `auth.router.ts` → split into `auth.router.ts`, `auth.registration.router.ts`, `auth.login.router.ts`, `auth.two-factor.router.ts`
- **New tests:** Password reset, agent 2FA enforcement, RBAC, email enumeration, login lockout

### Notification Domain
- **Modified:** `notification.types.ts` (add notificationType, attachment types)
- **Modified:** `notification.service.ts` (preference check, consent check, audit logging, provider dispatch, retry logic)
- **Modified:** `notification.repository.ts` (no major changes)
- **Modified:** `notification.router.ts` (webhook signature fix, unsubscribe endpoint)
- **New:** `notification.templates.ts` (extracted from service)
- **New:** `notification.validator.ts`
- **Modified:** `providers/email.provider.ts` (attachments, retry logic)
- **Modified:** `providers/in-app.provider.ts` (wire into service)
- **New:** `src/views/emails/base.njk` and per-template email views
- **New tests:** Preference, consent, webhook signature, audit, templates, unsubscribe, attachments, retry

### Agent-Settings Domain
- **New:** `agent-settings.validator.ts`
- **Modified:** `agent-settings.router.ts` (apply validators, fix HTMX)
- **Modified:** `agent-settings.repository.ts` (fix deleteMany → delete)
- **Modified:** `agent-settings.service.ts` (null-safety, error logging)
- **New:** `agent-settings.router.test.ts`, `agent-settings.repository.test.ts`

---

## Out of Scope

- Buyer notification preferences (buyer is a stub)
- WhatsApp Business API template registration automation
- Email template visual design (functional branding only)
- SMS as a notification channel
- Push notifications via service worker
- Password complexity requirements beyond current validation
