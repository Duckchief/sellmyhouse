# Design: Per-row HTMX targeting for document uploads

**Date:** 2026-03-23
**Status:** Approved

## Problem

On `/seller/documents`, each document type has its own upload `<form>` but all forms target `#document-checklist` with `hx-swap="outerHTML"`. When one form submits, the server responds with a fully re-rendered checklist, and HTMX replaces the entire `<ul>` — wiping out file selections in every other row's `<input type="file">`.

## Solution

Each `<li>` row gets a unique ID. Each form targets only its own row. The server returns only the affected row partial. Other rows are untouched, preserving their file input state.

## Changes

### Template: `document-checklist.njk`

- Add `id="doc-row-{{ item.id }}"` to each `<li>`
- Extract `<li>` body into `partials/seller/document-checklist-row.njk`
- Loop in `document-checklist.njk` includes the row partial
- Replace inline `<script>` with event delegation on `#document-checklist` for `change` events on `[data-doc-file-input]` — survives DOM swaps without re-running

### New partial: `document-checklist-row.njk`

- Contains the full `<li id="doc-row-{{ item.id }}">` markup
- Form attributes: `hx-post="/seller/documents"`, `hx-target="#doc-row-{{ item.id }}"`, `hx-swap="outerHTML"`
- Reused by both the checklist loop and POST/DELETE responses

### Router: `seller.router.ts`

- POST `/seller/documents`: after upload, render `partials/seller/document-checklist-row` with the single updated item (checklist entry + its active documents)
- DELETE `/seller/documents/:id`: same — render just the affected row
- GET `/seller/documents` (full list): unchanged, still renders full checklist

### Script

- Event delegation on `#document-checklist` listening for `change` on `[data-doc-file-input]`
- Enables/disables the submit button in the same form
- Lives in `document-checklist.njk` (the wrapper), not in the row partial
