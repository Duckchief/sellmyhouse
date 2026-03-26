# Email Verification at Registration — Design

**Date:** 2026-03-19
**Status:** Approved

## Overview

Sellers must verify their email address before they can create a listing. After registration, a time-limited verification link is emailed to them. They can log in immediately but are gated from listing creation until verified. A "Resend verification email" button is available on the dashboard.

---

## 1. Data Model

Three new fields on the `Seller` model:

```prisma
emailVerified           Boolean   @default(false)
emailVerificationToken  String?   // SHA-256 hash of the raw token
emailVerificationExpiry DateTime?
```

Token generation pattern mirrors password reset:
- Raw token: `crypto.randomBytes(32).toString('hex')`
- Stored: `sha256(rawToken)`
- Expiry: 24 hours from generation

**Migration:** `prisma/migrations/20260319120000_email_verification/migration.sql`

---

## 2. System Mailer

New helper: `src/infra/email/system-mailer.ts`

```ts
export async function sendSystemEmail(to: string, subject: string, html: string): Promise<void>
```

- Reads from env vars: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
- Throws if SMTP env vars are not configured
- No retries — simple single-send
- Used only for system-triggered emails (email verification). Password reset is unchanged.

---

## 3. Routes & Service Logic

### New repo functions (`auth.repository.ts`)

- `setSellerEmailVerificationToken(id, hashedToken, expiry)` — stores token hash + expiry
- `findSellerByEmailVerificationToken(hashedToken)` — finds seller by hashed token
- `markSellerEmailVerified(id)` — sets `emailVerified = true`, clears token fields

### New service functions (`auth.service.ts`)

- `sendVerificationEmail(sellerId, email)` — generates token, calls repo, sends via `sendSystemEmail`
- `verifyEmail(token)` — hashes token, finds seller, checks expiry, calls `markSellerEmailVerified`
- `resendVerificationEmail(sellerId, email)` — regenerates token, calls `sendVerificationEmail`

### Changes to existing functions

- `registerSeller()` — after creating seller, call `sendVerificationEmail(seller.id, seller.email)`
- `property.service.createProperty()` — fetch seller, throw `ValidationError` if `!seller.emailVerified`

### New routes (`auth.registration.router.ts`)

- `GET /auth/verify-email/:token` — calls `authService.verifyEmail()`, redirects to `/seller/dashboard?verified=1` on success; renders error page on invalid/expired token
- `POST /auth/resend-verification` — requires seller auth; calls `authService.resendVerificationEmail()`; rate-limited (3 attempts/hour, skip in test)

### Audit logs

| Action | When |
|--------|------|
| `auth.email_verification_sent` | After sending verification email |
| `auth.email_verified` | After successful token verification |
| `auth.email_verification_resent` | After resend request |

---

## 4. Dashboard UI

Banner added above the case-flags alert in `src/views/pages/seller/dashboard.njk`:

```nunjucks
{% if not overview.seller.emailVerified %}
<div class="bg-blue-50 border-l-4 border-blue-400 p-4 mb-6">
  <p class="text-sm font-medium text-blue-800">
    {{ "Please verify your email to start listing your property." | t }}
  </p>
  <form method="POST" action="/auth/resend-verification" class="mt-2">
    <input type="hidden" name="_csrf" value="{{ csrfToken }}">
    <button type="submit" class="text-sm text-blue-700 underline hover:text-blue-900">
      {{ "Resend verification email" | t }}
    </button>
  </form>
</div>
{% endif %}
```

`overview.seller.emailVerified` is exposed via `getDashboardOverview()` (already returns seller data).

---

## 5. Email Template

Verification email HTML (inline in `sendVerificationEmail`, no Nunjucks template needed):

```
Subject: Verify your SellMyHouse email address

Click the link below to verify your email:
{{verificationUrl}}

This link expires in 24 hours.

If you did not register on SellMyHouse, please ignore this email.
```

URL format: `${APP_URL}/auth/verify-email/${rawToken}`

---

## Out of Scope

- Agents do not go through email verification (agents are created by admin)
- No re-verification on email change (not implemented in this version)
