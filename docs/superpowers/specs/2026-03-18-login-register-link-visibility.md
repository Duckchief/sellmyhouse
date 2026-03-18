# Spec: Login Page — Register Link Visibility

**Date:** 2026-03-18
**Status:** Approved

## Problem

The "Don't have an account? Register" link on `/auth/login` is always visible, regardless of which tab is active. When the Agent tab is selected, this link is misleading — agents cannot self-register; their accounts are created by an administrator only.

## Decision

Move the register link `<p>` element inside `#seller-form` so it hides and shows automatically with the existing tab-switching behaviour.

## What Changes

**File:** `src/views/pages/auth/login.njk`

- Move the `<p class="mt-4 ...">Don't have an account? Register</p>` from outside both form divs to the bottom of `<div id="seller-form">`.

No changes to `app.js`, CSS, routers, or any other file.

## Behaviour

| Tab active | Register link |
|---|---|
| Seller (default) | Visible |
| Agent | Hidden (no text, no placeholder) |

## Why This Approach

The register link is semantically a seller-only element. Placing it inside `#seller-form` makes the HTML structure reflect the business rule. The existing `switch-tab` JS already toggles `hidden` on that container, so the link hides for free — zero new code.
