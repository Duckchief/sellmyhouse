# Account Setup Invite on Lead→Engaged — Design

**Date:** 2026-03-22
**Status:** Approved

## Overview

When an agent moves a seller from `lead` to `engaged`, the system automatically sends an account setup email to the seller's verified email address. The seller clicks the link, sets a password, and is auto-logged into their dashboard. This bridges the gap between the lead capture flow (no account) and the seller dashboard (requires login).

Reuses the existing `passwordResetToken`/`passwordResetExpiry` fields on the Seller model — no schema migration needed.

---

## 1. Trigger: `updateSellerStatus` Hook

In `seller.service.ts`, after the `lead→engaged` status update:

1. Check `seller.emailVerified === true`
2. If verified: generate token (`crypto.randomBytes(64).toString('hex')`), SHA-256 hash, store in `passwordResetToken`/`passwordResetExpiry` (24-hour expiry)
3. Send "Account Setup" email via `sendSystemEmail` with link: `/auth/setup-account?token=<rawToken>`
4. Audit log: `lead.account_setup_sent`
5. If `emailVerified === false`: skip sending, log warning. Agent sees flash message: "Account setup not sent — seller has not verified their email."

---

## 2. Setup Account Route & Page

### `GET /auth/setup-account?token=<token>`

1. Hash token, look up seller by `passwordResetToken` where `passwordResetExpiry > now`
2. If invalid/expired: render error page
3. If valid: render "Set Your Password" form with token in hidden field

### `POST /auth/setup-account`

1. Validate: token, password (min 8 chars), confirmation match
2. Hash password with bcrypt (cost 12)
3. Update seller `passwordHash`, clear `passwordResetToken`/`passwordResetExpiry`
4. Invalidate existing sessions
5. Auto-login via passport `seller-local` strategy
6. Redirect to `/seller/dashboard`
7. Audit log: `auth.account_setup_completed`

### Why a separate route from `/auth/reset-password`?

Different copy ("Welcome! Set your password" vs "Enter your new password") and auto-login on first setup is cleaner in its own route. Underlying auth service functions are reused.

---

## 3. Seller Detail Page — Resend & Status Indicators

When seller is `engaged` and `passwordHash === null`:

- Grey badge: "Account not yet set up" (next to email)
- "Resend Account Setup" button (HTMX POST to `/agent/sellers/:id/resend-account-setup`)

When seller has set their password (`passwordHash !== null`):

- Green badge: "Account active"
- Resend button hidden

### Resend endpoint: `POST /agent/sellers/:id/resend-account-setup`

- Agent auth required
- Confirm seller has verified email and no password yet
- Generate new token, 24-hour expiry, send email
- Audit log: `lead.account_setup_resent`
- HTMX response: flash success

### Data change

`SellerDetail` type gains `hasPassword: boolean` (derived from `passwordHash !== null` — never expose the hash).

---

## 4. Email Template

```
Subject: Set up your SellMyHomeNow account

Hi [name],

Your agent has invited you to set up your SellMyHomeNow account.
Click the link below to create your password and access your dashboard:

[setupUrl]

This link expires in 24 hours.

If you did not expect this email, please ignore it.
```

Uses existing `sendSystemEmail` from `src/infra/email/system-mailer.ts` (stub logs when SMTP not configured).

---

## 5. Audit Events

| Action | When |
|--------|------|
| `lead.account_setup_sent` | Setup email sent on `lead→engaged` |
| `auth.account_setup_completed` | Seller sets password via setup link |
| `lead.account_setup_resent` | Agent resends setup email |

---

## Out of Scope

- Schema migration (reuses existing `passwordResetToken`/`passwordResetExpiry` fields)
- Real email transport (uses existing stub)
- Seller-initiated resend (agent-only for this flow)
