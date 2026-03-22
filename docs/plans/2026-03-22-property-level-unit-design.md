# Property Level & Unit Number — Design

**Date:** 2026-03-22
**Status:** Approved

## Overview

Replace the `storeyRange` and `flatModel` fields on the `Property` model with two explicit fields: `level` and `unitNumber`. Together they form the HDB unit address `#07-123`. The seller enters these during onboarding step 2.

`HdbTransaction.storeyRange` and `HdbTransaction.flatModel` (CSV import data) are **not changed**.

---

## Schema Changes

**Remove from `Property`:**
- `storeyRange String @map("storey_range")`
- `flatModel String @map("flat_model")`

**Add to `Property`:**
- `level String @map("level")`
- `unitNumber String @map("unit_number")`

One migration. No data backfill needed (dev/test data uses factory defaults).

---

## Display Format

Wherever the unit address is shown: `#${level}-${unitNumber}` → e.g. `#07-123`.

Portal formatter emits this string for listing content.

---

## Form Changes

**Onboarding step 2 & property-form partial:**

Remove: Storey Range, Flat Model
Add:
- **Level** — text input, placeholder `e.g. 07`, required
- **Unit Number** — text input, placeholder `e.g. 123`, required

---

## Files to Change

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Remove storeyRange/flatModel from Property, add level/unitNumber |
| New migration | Drop storey_range/flat_model columns, add level/unit_number |
| `src/domains/property/property.types.ts` | Update CreatePropertyInput, UpdatePropertyInput |
| `src/domains/property/property.validator.ts` | Replace storeyRange/flatModel rules with level/unitNumber |
| `src/domains/property/property.router.ts` | Destructure and pass level/unitNumber |
| `src/domains/property/portal.formatter.ts` | Use `#${level}-${unitNumber}` format |
| `src/domains/seller/seller.router.ts` | Update onboarding step 2 handler |
| `src/domains/agent/agent.types.ts` | Update property detail type |
| `src/domains/agent/agent.service.ts` | Map level/unitNumber |
| `src/domains/admin/admin.types.ts` | Update seller detail property type |
| `src/domains/admin/admin.service.ts` | Map level/unitNumber |
| `src/domains/lead/verification.service.ts` | Update default values |
| `src/views/partials/seller/onboarding-step-2.njk` | Replace fields in form |
| `src/views/partials/seller/property-form.njk` | Replace fields in form |
| `src/views/pages/admin/seller-detail.njk` | Update display |
| `tests/fixtures/factory.ts` | Update PropertyInput defaults |
| Affected integration/unit tests | Update field references |

---

## Out of Scope

- `HdbTransaction.storeyRange` / `HdbTransaction.flatModel` — unchanged (CSV import data)
- Market report storey range filter — unchanged (operates on HdbTransaction data)
- Any validation of level/unit format (free text for now)
