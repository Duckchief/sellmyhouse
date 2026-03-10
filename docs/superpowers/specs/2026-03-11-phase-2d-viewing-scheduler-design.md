# Phase 2D: Viewing Scheduler — Design Spec

**Date:** 2026-03-11
**Status:** Approved
**Depends on:** Phase 2B (Property), Phase 1 (Notification, Auth, Shared infra)

## Overview

Viewing Scheduler enables sellers to create viewing slots for their properties and allows buyers/agents to book viewings through a public portal with phone OTP verification. Follows the monolithic service pattern consistent with all other domains.

## Domain Structure

```
src/domains/viewing/
├── viewing.types.ts           # Existing — add interestRating, OTP types
├── viewing.repository.ts      # Prisma CRUD, row-level locking
├── viewing.service.ts         # All business logic
├── viewing.validator.ts       # Input validation
├── viewing.router.ts          # Seller + public routes
└── __tests__/
    ├── viewing.service.test.ts
    ├── viewing.repository.test.ts
    └── viewing.router.test.ts
```

## Repository Layer

Functions grouped by concern:

**Slots:** `createSlot`, `createManySlots` (bulk), `findSlotById`, `findSlotsByPropertyAndDateRange`, `updateSlotStatus`, `cancelSlotAndViewings` (transaction — cancel slot + all its viewings)

**Bookings:** `createViewingWithLock` (transaction + `SELECT FOR UPDATE` on slot to prevent race conditions), `findViewingById`, `findViewingByCancelToken`, `updateViewingStatus`, `findViewingsBySlot`

**Viewers:** `findVerifiedViewerByPhone`, `createVerifiedViewer`, `incrementNoShow`, `incrementBookings`

**Queries:** `findUpcomingViewingsForProperty`, `getViewingStats`, `findViewingsNeedingReminder`, `findViewingsNeedingFeedbackPrompt`

## Service Layer

One `viewing.service.ts` with these logical groups:

### Slot Management

- `createSlot(input)` — validate, create single slot, audit log
- `createBulkSlots(input)` — generate slots for recurring weekly pattern (e.g., every Saturday 10am-12pm split into 15-min slots for 4 weeks), audit log
- `cancelSlot(slotId, sellerId)` — verify ownership, cancel slot, cascade cancel all viewings (reset `currentBookings` to 0), notify all affected viewers, audit log

### Booking Flow

- `initiateBooking(input, ip)` — spam checks (honeypot, time-based, rate limits, duplicate), find-or-create VerifiedViewer, check no-show history (attach warning flag), acquire slot lock via transaction, create viewing
  - **Returning viewer** (phone already verified): skip OTP, set status to `scheduled`, notify seller
  - **New viewer**: set status to `pending_otp`, generate 6-digit OTP, send via WhatsApp
- `verifyOtp(input)` — validate OTP (expiry, max attempts), transition to `scheduled`, notify seller
- `cancelViewing(viewingId, cancelToken)` — validate token, cancel viewing, decrement slot bookings, update slot status if now available, notify seller

### OTP Handling

OTP stored on the Viewing record itself (no separate table):
- `otpHash` — bcrypt hash of 6-digit code
- `otpExpiresAt` — 5 minute expiry
- `otpAttempts` — max 3, then reject

WhatsApp-only delivery (no SMS fallback).

### Post-Viewing

- `submitFeedback(viewingId, sellerId, feedback, interestRating)` — verify ownership, save text + 1-5 rating
- `markNoShow(viewingId, sellerId)` — verify ownership, transition to `no_show`, increment viewer's no-show count
- `markCompleted(viewingId, sellerId)` — transition to `completed`, set `completedAt`

### Reminders (Cron Jobs)

- `sendMorningReminders()` — find today's viewings, group by seller, one consolidated notification per seller
- `sendOneHourReminders()` — find viewings starting in 60-75 min, send individual reminders to viewer + seller
- `sendFeedbackPrompts()` — find viewings whose slot end time is >1hr ago, status is `completed`, and have no feedback yet. Uses slot `date` + `endTime` (not `completedAt`) to determine timing.

### Stats

- `getViewingStats(propertyId, sellerId)` — total viewings, upcoming count, average interest rating, no-show count

## Validator

- `validateCreateSlot(body)` — date (future), startTime/endTime (HH:MM, end > start), slotType, maxViewers (required if group)
- `validateCreateBulkSlots(body)` — startDate/endDate (future, max 8 weeks), dayOfWeek (0-6), time range, slotDuration
- `validateBookingForm(body)` — name, phone (SG: 8 digits starting 8/9), viewerType, agent fields if agent, consentService=true, slotId
- `validateOtp(body)` — phone, otp (6 digits), bookingId
- `validateFeedback(body)` — feedback (max 1000 chars), interestRating (1-5 integer)

## Router

### Seller Routes (require `requireAuth()`)

```
GET    /seller/viewings                    — dashboard (slots list + stats)
POST   /seller/viewings/slots              — create slot(s)
DELETE  /seller/viewings/slots/:id          — cancel slot
POST   /seller/viewings/:id/feedback       — submit feedback + rating
POST   /seller/viewings/:id/no-show        — mark no-show
POST   /seller/viewings/:id/complete       — mark completed
```

### Public Routes (no auth)

```
GET    /view/:propertySlug                 — public booking page
POST   /view/:propertySlug/book            — submit booking
POST   /view/:propertySlug/verify-otp      — verify OTP
GET    /view/cancel/:viewingId/:cancelToken — render cancel confirmation page
POST   /view/cancel/:viewingId/:cancelToken — execute cancellation
```

The cancel route uses GET to show a confirmation page and POST to perform the actual cancellation. This prevents accidental cancellations from link prefetching or crawlers.

All routes: validate → service → HTMX partial or full page response.

Seller routes derive `sellerId` from `req.user.id` (authenticated session) and validate property ownership (seller owns the property that owns the slot/viewing).

**Note:** Agent-specific viewing routes (agent dashboard calendar) are out of scope for Phase 2D and will be added in Phase 3.

## Spam Protection (6 Layers)

1. **Honeypot** — hidden `website` field filled = bot, return fake 200 success
2. **Time-based** — `formLoadedAt` < 3 seconds = bot, return fake 200 success
3. **Phone OTP** — eliminates unverified bots
4. **Rate limit: 3 bookings/phone/day** — checked in service via viewer record
5. **Rate limit: 10 attempts/IP/hour** — Express rate limiter middleware on booking route
6. **Duplicate detection** — same phone + same slot = reject with user-friendly message

No reCAPTCHA (PDPA-conscious positioning).

## Notifications

| Event | Recipient | Template | Channel |
|-------|-----------|----------|---------|
| Booking confirmed | Viewer | `viewing_booked` | WhatsApp |
| Booking alert | Seller | `viewing_booked_seller` | WhatsApp + in-app |
| Viewing cancelled (by viewer) | Seller | `viewing_cancelled` | WhatsApp + in-app |
| Slot cancelled (by seller) | All viewers | `viewing_cancelled` | WhatsApp |
| Morning reminder | Seller | `viewing_reminder` | WhatsApp + in-app |
| 1-hour reminder | Viewer | `viewing_reminder_viewer` | WhatsApp |
| 1-hour reminder | Seller | `viewing_reminder` | WhatsApp + in-app |
| Feedback prompt | Seller | `viewing_feedback_prompt` | In-app only |

No-show warning is inline in `viewing_booked_seller` when viewer has previous no-shows.

**DNC Compliance:** Viewer WhatsApp notifications are transactional service messages, not marketing. Viewers explicitly provide their phone number and consent to service communications (`consentService: true`) during the booking form. This qualifies as consent-based transactional messaging, exempt from DNC registry checks.

## Cron Jobs

Registered via existing `registerJob()` in `src/infra/jobs/runner.ts`:

```
viewing:morning-reminders    — "0 9 * * *"      (daily 9am SGT)
viewing:one-hour-reminders   — "*/15 * * * *"   (every 15 min)
viewing:feedback-prompts     — "*/15 * * * *"   (every 15 min, >1hr after viewing end)
```

Timezone: `Asia/Singapore`.

## Schema Changes

### Add `slug` to `Property` model:

```prisma
slug String? @unique
```

Public-facing URLs use slugs for better UX (e.g., `/view/123-bishan-st-23`). Generated from property address during listing creation. Index on slug for fast lookups.

### Add `viewer` to `RecipientType` enum:

```prisma
enum RecipientType {
  seller
  agent
  viewer
}
```

Required for persisting viewer notification records (booking confirmations, reminders) through the standard notification service.

### Add to `Viewing` model:

```prisma
interestRating Int?      @map("interest_rating")
otpHash        String?   @map("otp_hash")
otpExpiresAt   DateTime? @map("otp_expires_at")
otpAttempts    Int       @default(0) @map("otp_attempts")
```

### Add to `VerifiedViewer` model:

```prisma
noShowCount Int @default(0) @map("no_show_count")
```

### Update `ViewingFeedbackInput` type:

Add `interestRating: number` (1-5) to the existing interface in `viewing.types.ts`.

### New notification template names:

`viewing_booked_seller`, `viewing_reminder_viewer`, `viewing_feedback_prompt`

## UI Approach

Simple date-grouped list/grid for both seller and public views (no month-view calendar widget):

- **Seller dashboard:** Slots grouped by date, each showing time/type/status with color badges (green=available, blue=booked, grey=full, red=cancelled). Stats summary at top.
- **Public booking page:** Property summary (no seller personal details), upcoming dates with available time slots as clickable buttons.

## Testing Strategy

### Unit Tests (`viewing.service.test.ts`)

- Slot creation — single and bulk (correct count for recurring)
- Slot cancellation cascade — cancels viewings, sends notifications
- Booking flow — new viewer triggers OTP, returning viewer skips
- OTP — valid, expired, max attempts
- Spam protection — honeypot, time-based, duplicate, rate limits
- State transitions — all valid and invalid
- Feedback — saves text + rating, rejects invalid
- No-show — increments viewer count, transitions status
- Morning reminders — groups by seller
- Stats — correct aggregation

### Integration Tests (`viewing.router.test.ts`)

- Full booking flow (new viewer + OTP)
- Returning viewer skips OTP
- Concurrent booking race condition (two requests, last single slot — only one succeeds)
- Slot cancellation updates availability
- Auth-guarded seller routes
- Public routes without auth
- HTMX partial vs full page
- Spam fake success for bots
- One-click cancel via token

### Mocked

Notification service (WhatsApp), audit service. Repository uses test DB.
