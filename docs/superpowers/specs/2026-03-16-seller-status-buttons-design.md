# Seller Status Buttons — Design Spec

**Date:** 2026-03-16
**Feature:** Agent-facing status advancement buttons on seller detail page

---

## Overview

Add action buttons to the seller detail page header so agents can advance a seller through the lifecycle (`lead → engaged → active → completed`) or archive them at any stage. Consequential transitions require a note, stored in the audit log.

---

## Status Transitions & Button Rules

| Current Status | Buttons Shown |
|---|---|
| `lead` | "Mark Engaged" + "Archive" |
| `engaged` | "Mark Active" + "Archive" |
| `active` | "Mark Completed" + "Archive" |
| `completed` | "Archive" |
| `archived` | _(no buttons)_ |

All buttons are shown in the header area, to the right of the status badge.

---

## Note Requirements

| Transition | Note Required? |
|---|---|
| lead → engaged | Yes — "Consultation note" |
| engaged → active | Yes — "Activation note" |
| active → completed | No |
| Any → archived | Yes — "Reason for archiving" |

---

## UX Flow

1. Agent clicks a button in the header (e.g. "Mark Engaged")
2. HTMX fetches `GET /agent/sellers/:id/status-modal?action=advance` (or `?action=archive`) into `#modal-container`
3. Modal renders with correct title, label, and a required textarea
4. Agent types a note and clicks Confirm
5. HTMX submits `PUT /agent/sellers/:id/status` with `{ status, note }`
6. On success: modal is removed, `#seller-header` re-renders with updated badge and new buttons
7. On error: inline error message shown inside the modal

---

## Templates

### Changes to `seller-detail.njk`
- Wrap the header block in `<div id="seller-header">` for HTMX re-render targeting
- Add `<div id="modal-container"></div>` inside `#seller-header`
- Include the status buttons partial (see below)

### New partial: `partials/agent/seller-status-buttons.njk`
Context-aware buttons rendered based on `seller.status`:
- Each button does `hx-get="/agent/sellers/{{ seller.id }}/status-modal?action=..."` into `#modal-container`

### New partial: `partials/agent/seller-status-modal.njk`
Reusable modal with:
- Dynamic title and textarea label (passed as template variables)
- Required textarea (`name="note"`)
- Cancel button: removes modal via `data-action="remove-element"`
- Confirm button: `hx-put="/agent/sellers/{{ seller.id }}/status"` with hidden `status` input, targets `#seller-header`, `hx-swap="outerHTML"`

---

## Backend Changes

### `agent.router.ts`
- Add `GET /agent/sellers/:id/status-modal` — renders `seller-status-modal.njk` with computed `nextStatus`, `title`, and `label` based on `?action` param
- Update `PUT /agent/sellers/:id/status` — accept optional `note` field in request body

### `seller.service.ts` — `updateSellerStatus()`
- Accept optional `note` parameter
- Include `note` in the `details` JSON of the existing audit log entry

### Validation
- `note` is required at the service level when transitioning lead→engaged, engaged→active, or any→archived; optional for active→completed
- `ValidationError` if required note is missing

---

## No Schema Changes

The audit log `details` field is already a JSON column. The note is stored there — no migration required.

---

## Error Handling

- Invalid transition (already blocked by state machine): modal shows error inline
- Missing required note: modal shows validation error inline
- Both cases: modal stays open, no status change persisted
