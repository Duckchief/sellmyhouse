# Marketing Consent Touchpoints — Design

**Date:** 2026-03-22
**Status:** Approved

## Problem

Sellers have a `consentMarketing` field that defaults to `false`. There is currently no way to grant marketing consent after registration — only withdraw it. The Day 14 referral message in `transaction.jobs.ts` is already gated on `consentMarketing`, so sellers who never opted in will never receive it.

Three in-product touchpoints are needed to allow sellers to opt in within the normal course of service, without any outbound contact.

## Compliance Notes

- Marketing consent is never pre-ticked
- Asking for marketing consent via outbound message (WhatsApp/email) is prohibited if the seller is on the DNC Registry and has not given marketing consent
- All consent changes are append-only `ConsentRecord` entries — never modify existing records
- Grant and withdraw are both self-service seller actions

---

## Backend

### New endpoint

```
POST /seller/compliance/consent/grant
Body: { type: "marketing", channel: "web" }
Auth: requireAuth(), requireRole('seller')
```

Mirrors the existing `POST /seller/compliance/consent/withdraw` endpoint exactly. The compliance service gains a `grantMarketingConsent(sellerId)` method that:

1. Sets `seller.consentMarketing = true`
2. Creates an append-only `ConsentRecord`
3. Writes an audit log entry

HTMX responses return the updated `consent-panel` partial. Full-page responses redirect to `/seller/my-data`.

### Onboarding step 4

The existing `POST /seller/onboarding/step/4` handler reads an optional `marketingConsent` checkbox from the request body. If `req.body.marketingConsent === 'on'`, it calls `complianceService.grantMarketingConsent(sellerId)`. No new route needed.

### Dashboard prompt flag

`sellerService.getDashboardOverview` gains a `showMarketingPrompt: boolean` field. It is `true` when:
- `seller.consentMarketing === false`, AND
- `seller.createdAt` is 14+ days ago

No new DB column required.

---

## Touchpoint 1: Onboarding Step 4 (Photos)

A consent block is added above the Continue button in `onboarding-step-4.njk`:

```
□ Keep me informed about market updates and the referral programme
  We'll send occasional updates. You can opt out any time in Settings.
```

- Checkbox is never pre-ticked
- Optional — skipping leaves `consentMarketing` as `false`
- If checked, consent is granted when the step 4 form is submitted

---

## Touchpoint 2: Seller Dashboard Prompt

When `showMarketingPrompt` is true, a card appears in the dashboard body among the other cards.

**Copy:**
```
Refer a friend
Know someone selling their HDB? Share the love with your friend
with your referral link. Opt in to hear about market updates too.

[Yes, keep me informed]
```

- Button HTMX-posts to `POST /seller/compliance/consent/grant`
- On success, the card wrapper swaps out via HTMX outerHTML — card disappears
- No dismiss button — disappears only on opt-in
- Once `consentMarketing` is true, `showMarketingPrompt` is never returned as true again

---

## Touchpoint 3a: Settings Page (lightweight toggle)

A new consent card added to the seller settings page below the notification preferences.

```
Marketing Communications
Market updates and referral programme.

[toggle: off/on]
```

- Toggle off → posts to `POST /seller/compliance/consent/grant`
- Toggle on → posts to `POST /seller/compliance/consent/withdraw`
- Card re-renders via HTMX outerHTML swap on response

---

## Touchpoint 3b: My Data Page (full consent panel)

The existing `consent-panel.njk` already shows status and a withdraw button when marketing consent is active. The gap — no action when `consentMarketing` is false — is filled by a grant button:

```
Marketing Communications    [Not given]  [Give consent]
```

- `[Give consent]` HTMX-posts to `POST /seller/compliance/consent/grant`
- On success, `#consent-panel` re-renders showing "Active" + the withdraw button
- Consent history below automatically reflects the new record — no changes needed there
