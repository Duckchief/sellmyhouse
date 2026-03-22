# Lead Enrichment via Email Verification — Design

**Date:** 2026-03-22
**Status:** Approved
**Supersedes:** `2026-03-19-email-verification-design.md` (different approach — that design gated listing creation post-registration; this design moves email verification to lead capture and uses it to collect property details before agent contact)

## Overview

The lead form gains an email field. After submission, the system sends a verification email with a tokenised link. When the seller clicks the link, their email is verified and they land on a one-time public form to provide property details (HDB address, asking price, timeline, reason to sell). This enriches the lead before the agent makes first contact.

Agents see leads grouped by: Unassigned > Verified > Unverified. The seller detail page shows contact info (phone + email) and the new lead-qualification data.

---

## 1. Data Model Changes

### Seller model — new fields

```prisma
sellingTimeline     SellingTimeline?  @map("selling_timeline")
sellingReason       SellingReason?    @map("selling_reason")
sellingReasonOther  String?           @map("selling_reason_other")
```

### Existing fields (no migration needed)

- `email` (String?, @unique)
- `emailVerified` (Boolean, default false)
- `emailVerificationToken` (String?)
- `emailVerificationExpiry` (DateTime?)

### New enums

```prisma
enum SellingTimeline {
  one_to_three_months
  three_to_six_months
  just_thinking
}

enum SellingReason {
  upgrading
  downsizing
  relocating
  financial
  investment
  other
}
```

### Property model — no changes

A Property record (status: `draft`) is created when the seller submits the post-verification details form. Existing fields `block`, `street`, `town`, `askingPrice` are used.

---

## 2. Lead Submission Flow

### Lead form changes

- Add required email field below phone
- Validate email format in `lead.validator.ts`
- Pass email through to `submitLeadAtomically` — stored on Seller record

### Post-submission (in `lead.service.ts`)

1. Create seller + consent record atomically (as today, now including email)
2. Generate verification token: `crypto.randomBytes(32).toString('hex')`
3. Set `emailVerificationToken` (SHA-256 hash of raw token) and `emailVerificationExpiry` (72 hours)
4. Send verification email via email stub (see Section 7)
5. Lead success page updated: "Check your email to complete your submission"

### Duplicate handling

- Phone uniqueness check at submission (existing behaviour)
- Email uniqueness enforced by Prisma `@unique` constraint at submission — friendly error if duplicate

---

## 3. Email Verification & Details Form

### Verification endpoint: `GET /verify-email?token=<token>`

1. SHA-256 hash the token from query string
2. Look up seller by `emailVerificationToken` where `emailVerificationExpiry > now`
3. If invalid/expired: render error page with resend option
4. If valid: set `emailVerified = true`, clear token fields, render details form

### Details form (public, one-time)

Rendered inline on successful verification. Posts to `POST /verify-email/details` with a signed seller ID (HMAC with app secret) in a hidden field.

**Form fields:**
- Block number (text, required)
- Street name (text, required)
- Town (dropdown — ~26 HDB towns, required)
- Asking price (number, optional — labelled "Indicative asking price" with disclaimer "This is not a formal valuation")
- Timeline to sell (radio: "1-3 months", "3-6 months", "Just thinking about it")
- Reason to sell (dropdown: Upgrading, Downsizing, Relocating, Financial reasons, Investment, Other + conditional text field for "Other")

### On submit (`POST /verify-email/details`)

1. Validate HMAC signature on seller ID
2. Validate all form fields
3. Create Property record (status: `draft`, linked to seller) with block, street, town, askingPrice
4. Update seller with `sellingTimeline`, `sellingReason`, `sellingReasonOther`
5. Audit log: `lead.details_submitted`
6. Render "Thank you — your agent will be in touch" confirmation page
7. Notify assigned agent (if any) that the lead has been enriched

### Security

- Signed seller ID (HMAC) in hidden field — no login session needed
- Token is single-use: cleared on verification
- Rate-limited via existing rate limiters

---

## 4. Resend Verification

### Seller-initiated: `POST /api/leads/resend-verification`

- Body: `{ email: string }`
- Look up seller by email where `emailVerified = false` and status is `lead`
- If not found: return success anyway (don't leak email existence)
- If found: generate new token, set new 72-hour expiry, send email
- Rate-limited: 3 requests per email per hour

### Agent-initiated: `POST /agent/sellers/:id/resend-verification`

- Agent auth required
- Confirm `emailVerified = false`
- Generate new token, set new 72-hour expiry, send email
- Audit log: `lead.verification_resent` (with agent ID)
- HTMX response: flash success message on seller detail page

---

## 5. Agent Leads Page

### Current state

Two groups: Unassigned / All

### New state

Three groups in order:

1. **Unassigned Leads** — no agent assigned (regardless of verification status)
2. **Verified Leads** — assigned, `emailVerified = true`
3. **Unverified Leads** — assigned, `emailVerified = false`

Each group only renders if it has leads.

### Table columns

| Name | Phone | Email | Source | Verified | Time | Notified |

- Verified column: green checkmark or grey dash

### Data changes

- `LeadQueueItem` gains: `email: string | null`, `emailVerified: boolean`
- `LeadQueueResult` changes from `{ unassigned, all }` to `{ unassigned, verified, unverified }`
- `getLeadQueue` service splits assigned leads by `emailVerified`

---

## 6. Seller Detail Page

### Overview → Seller Info additions

| Field | Display |
|-------|---------|
| Phone | Formatted phone number |
| Email | Email with Verified/Unverified badge |
| Timeline | "1-3 months" / "3-6 months" / "Just thinking about it" / "—" |
| Reason | "Upgrading" / "Other: [text]" / "—" |

### Agent action

If `emailVerified = false`: show "Resend Verification Email" button (HTMX POST to agent resend endpoint).

---

## 7. Email Stub

Email transport is not yet configured. The design uses a stub:

- `src/infra/email/system-mailer.ts` exports `sendSystemEmail(to, subject, html)`
- Stub implementation: logs recipient, subject, and full verification URL via `logger.info`
- Tagged with `[EMAIL_STUB]` prefix for easy grep in logs
- When a real provider is configured later (SendGrid, SES, etc.), only this file changes

---

## 8. Audit Events

| Action | When |
|--------|------|
| `lead.created` | Lead form submitted (existing) |
| `lead.verification_sent` | Verification email sent |
| `lead.email_verified` | Token verified successfully |
| `lead.details_submitted` | Post-verification details form submitted |
| `lead.verification_resent` | Resend triggered (seller or agent) |

---

## Out of Scope

- Real email transport (stubbed — see Section 7)
- Seller account creation / login (seller is still just a lead at this point)
- Re-verification on email change
- Agent email verification (agents are created by admin)
