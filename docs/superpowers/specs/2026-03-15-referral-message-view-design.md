# Referral Message View — Design Spec

**Goal:** Add a "View Message" button to each row of the Top Referrers table in `/admin/content/referrals` that expands an inline panel showing the pre-composed WhatsApp sharing message with a Copy button.

**Architecture:** Pure template change — no new routes, services, or schema fields. The message is composed inline from `referralCode` and `baseUrl` already present in page context. Toggle behaviour uses vanilla JS (consistent with the existing `data-action="copy-value"` pattern).

**Tech Stack:** Nunjucks, vanilla JS, Tailwind CSS

---

## Data

No schema changes. The pre-composed message is built from existing fields:

```
Hi! I've been using SellMyHouse.sg to sell my HDB flat — it's hassle-free
with a fixed fee of just $1,499. Sign up with my referral link:
{baseUrl}/?ref={referralCode}
```

`baseUrl` is already passed to all pages via the global Nunjucks context.

---

## UI Changes

**File:** `src/views/partials/admin/referral-top-table.njk`

1. Add an **Actions** `<th>` column header (right-aligned).
2. Each data `<tr>` gains a **"View Message"** button in the Actions `<td>`.
   - Small, text-style button: `text-accent text-xs hover:underline`
   - `data-action="toggle-referral-message"` + `data-target="msg-{referralCode}"`
3. After each data `<tr>`, insert a hidden expansion `<tr id="msg-{referralCode}">` containing:
   - A `colspan="5"` cell with a light-grey background
   - `<textarea readonly>` containing the pre-composed message (id for copy target)
   - Copy button using existing `data-action="copy-value"` pattern
4. Vanilla JS in the partial (or site JS) handles the toggle:
   - Finds the target row by id, toggles `hidden` class
   - Flips button text between "View Message" / "Hide"

---

## No Changes To

- `admin.router.ts` — no new route
- `content.service.ts` / `content.repository.ts` — no new query
- `prisma/schema.prisma` — no new field
- Any other file
