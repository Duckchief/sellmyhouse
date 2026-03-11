# Phase 3 SP3: Admin — Team Management & System Settings — Design Spec

**Date:** 2026-03-11
**Status:** Approved
**Depends on:** SP1 (agent domain patterns), SP2 (review domain patterns)

---

## Overview

SP3 builds the admin-only dashboard sections for team management, system settings, and HDB data
management. It introduces the `src/domains/admin/` domain following the thin-orchestration pattern:
the admin service delegates to existing services (auth, email provider, hdb sync, settings) and
the admin repository handles admin-specific read queries only.

---

## Domain Structure

```
src/domains/admin/
├── admin.types.ts          # TeamMember, AgentCreateInput, SellerAssignInput, HdbDataStatus
├── admin.service.ts        # Orchestration: team CRUD, seller reassign, settings, HDB
├── admin.repository.ts     # Admin-specific queries: team list with counts, cross-agent sellers
├── admin.router.ts         # Routes under /admin/*
├── admin.validator.ts      # Input validation + exhaustive SETTING_VALIDATORS map
├── __tests__/
│   ├── admin.service.test.ts
│   └── admin.router.test.ts
```

---

## Routes

All routes: `requireAuth()`, `requireRole('admin')`, `requireTwoFactor()`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/dashboard` | Admin overview (pipeline, all agents) |
| GET | `/admin/team` | All agents with pipeline counts |
| POST | `/admin/team` | Create agent account |
| POST | `/admin/team/:id/deactivate` | Deactivate agent |
| POST | `/admin/team/:id/reactivate` | Reactivate agent |
| POST | `/admin/team/:id/anonymise` | Anonymise agent (irreversible) |
| GET | `/admin/team/:id/pipeline` | View agent's pipeline |
| GET | `/admin/sellers` | All sellers cross-agent, filterable |
| POST | `/admin/sellers/:id/assign` | Assign unassigned lead to agent |
| POST | `/admin/sellers/:id/reassign` | Reassign seller to different agent |
| GET | `/admin/settings` | Settings panel |
| POST | `/admin/settings/:key` | Update single setting |
| GET | `/admin/hdb` | HDB data status + sync history |
| POST | `/admin/hdb/sync` | Trigger manual sync |
| POST | `/admin/hdb/upload` | Upload CSV fallback |

---

## Team Management

### Create Agent

1. Validate input: name, email, phone, CEA reg — all required
2. Check email uniqueness — throw `ConflictError` if taken
3. Generate 16-char random temp password via `crypto.randomBytes`
4. `bcrypt.hash(tempPassword, 12)`
5. Create `Agent` record via `admin.repository.createAgent()`
6. Send credentials email via direct `emailProvider.send()` call (not notification service)
7. Audit: `agent.created` — `{ name, email, ceaRegNo, createdBy: adminId }`

No force-reset flag — not in schema. Admin resends credentials manually if needed.

### Deactivate

Guard: count sellers where `agentId = id AND status NOT IN ('completed', 'archived')`.
If count > 0 → throw `ValidationError` with count (admin must reassign first).

On pass: `isActive = false`. Audit: `agent.deactivated` — `{ agentId, deactivatedBy, activeSellersCount: 0 }`.

### Reactivate

No guard. Set `isActive = true`. Audit: `agent.reactivated`.

### Anonymise (PDPA)

Guard: same as deactivate — active sellers block it.

Transformations:
```
name    → "Former Agent [id]"
email   → "anonymised-{id}@deleted.local"
phone   → null
isActive → false
```

`email → anonymised-{id}@deleted.local` (per CLAUDE.md — preserves unique identifier for audit log
referential integrity). `phone → null` (no referential integrity requirement).

Irreversible. HTMX confirm modal before submission. Audit: `agent.anonymised`.

### Seller Reassignment

`POST /admin/sellers/:id/reassign` body: `{ agentId: newAgentId }`

1. Validate new agent exists and is active
2. Update `seller.agentId`
3. Notify both agents via notification service
4. Audit: `lead.reassigned` — `{ fromAgentId, toAgentId, reason: 'admin_reassignment' }`

`POST /admin/sellers/:id/assign` — same flow, `fromAgentId` is null (unassigned lead).
Audit: `lead.assigned` — `{ agentId, assignmentMethod: 'manual' }`.

---

## System Settings Panel

### Update Flow

`POST /admin/settings/:key` — HTMX form per setting:

1. Look up key in `SETTING_VALIDATORS` — not found → `ValidationError`
2. Run validator — fails → return HTMX error partial
3. Read old value via `settings.service.get(key)`
4. Update via `settings.repository.update(key, value, adminId)`
5. Audit: `setting.changed` — `{ key, oldValue, newValue, changedBy: adminId }`
6. Return HTMX success partial

### New Setting Keys (add to `settings.types.ts`)

```typescript
display_price
post_completion_thankyou_delay_days
post_completion_testimonial_delay_days
post_completion_buyer_followup_delay_days
```

These are added to `SETTING_KEYS` and seeded in a migration.

### Validator Map (in `admin.validator.ts`)

TypeScript `Record<SettingKey, (v: string) => boolean>` — exhaustiveness enforced at compile time.

```typescript
const SETTING_VALIDATORS: Record<SettingKey, (v: string) => boolean> = {
  commission_amount:                         (v) => !isNaN(Number(v)) && Number(v) > 0,
  gst_rate:                                  (v) => !isNaN(Number(v)) && Number(v) >= 0 && Number(v) < 1,
  display_price:                             (v) => !isNaN(Number(v)) && Number(v) > 0,
  otp_exercise_days:                         (v) => Number.isInteger(Number(v)) && Number(v) > 0,
  reminder_schedule:                         (v) => { try { const a = JSON.parse(v); return Array.isArray(a) && a.every((n: unknown) => typeof n === 'number'); } catch { return false; } },
  post_completion_thankyou_delay_days:       (v) => Number.isInteger(Number(v)) && Number(v) >= 0,
  post_completion_testimonial_delay_days:    (v) => Number.isInteger(Number(v)) && Number(v) >= 0,
  post_completion_buyer_followup_delay_days: (v) => Number.isInteger(Number(v)) && Number(v) >= 0,
  whatsapp_enabled:                          (v) => v === 'true' || v === 'false',
  email_enabled:                             (v) => v === 'true' || v === 'false',
  maintenance_mode:                          (v) => v === 'true' || v === 'false',
  hdb_sync_schedule:                         (v) => /^[\d*,\-\/\s]+$/.test(v),
  lead_retention_months:                     (v) => Number.isInteger(Number(v)) && Number(v) > 0,
  transaction_retention_years:               (v) => Number.isInteger(Number(v)) && Number(v) >= 5,
  ai_provider:                               (v) => ['anthropic', 'openai', 'google'].includes(v),
  ai_model:                                  (v) => v.length > 0,
  ai_max_tokens:                             (v) => Number.isInteger(Number(v)) && Number(v) > 0,
  ai_temperature:                            (v) => !isNaN(Number(v)) && Number(v) >= 0 && Number(v) <= 2,
  viewing_slot_duration:                     (v) => Number.isInteger(Number(v)) && Number(v) > 0,
  viewing_max_group_size:                    (v) => Number.isInteger(Number(v)) && Number(v) > 0,
  market_content_schedule:                   (v) => /^[\d*,\-\/\s]+$/.test(v),
};
```

Settings displayed on the panel grouped by category: Pricing, OTP & Transaction, Notifications,
Data & Sync, AI, Platform.

---

## HDB Data Management

Admin domain calls existing `hdb.sync.service` — no reimplementation.

```typescript
interface HdbDataStatus {
  totalRecords: number;
  dateRange: { earliest: string; latest: string };
  lastSync: HdbDataSync | null;
  recentSyncs: HdbDataSync[];   // last 20
}
```

- `GET /admin/hdb` — assembles status from `hdb.repository` + `HdbDataSync` table
- `POST /admin/hdb/sync` — calls `hdb.sync.service.runSync()`. Audit: `hdb_sync.triggered_manually`
- `POST /admin/hdb/upload` — validates CSV, passes to existing ingestion. 10MB max, sanitized filename.

---

## Views

### Admin Layout (`src/views/layouts/admin.njk`)

Expand existing stub sidebar:
```
Dashboard | Team | Sellers | Settings | HDB Data
```

### Pages (`src/views/pages/admin/`)

```
dashboard.njk       — pipeline overview (no agentId filter — sees all)
team.njk            — agent list table
team-pipeline.njk   — single agent's pipeline
sellers.njk         — cross-agent seller table with assign/reassign
settings.njk        — settings panel grouped by category
hdb.njk             — HDB status + sync history
```

### Partials (`src/views/partials/admin/`)

```
team-list.njk             — agent rows with action buttons
team-action-result.njk    — HTMX swap after deactivate/reactivate/anonymise
seller-list.njk           — cross-agent table (includes agentId column)
assign-modal.njk          — agent picker for assignment/reassignment
settings-form.njk         — per-category setting fields
settings-result.njk       — HTMX inline success/error feedback
hdb-status.njk            — status card
hdb-sync-history.njk      — last 20 syncs table
anonymise-confirm.njk     — confirmation modal (irreversible warning)
```

All user-facing strings wrapped in `{{ "string" | t }}` per i18n convention.

---

## Test Coverage

### Unit Tests (`admin.service.test.ts`)

- `createAgent`: generates password, hashes bcrypt(12), creates record, sends email, audits
- `createAgent`: throws `ConflictError` if email already taken
- `deactivateAgent`: throws `ValidationError` with count when agent has active sellers
- `deactivateAgent`: succeeds and audits when no active sellers
- `anonymiseAgent`: sets name/email/phone correctly, audits
- `reassignSeller`: validates new agent is active, updates agentId, notifies both, audits
- `updateSetting`: validates via SETTING_VALIDATORS before saving
- `updateSetting`: throws `ValidationError` on invalid value (negative commission, bad cron, etc.)
- `updateSetting`: reads old value, audits with old+new, saves new value
- `updateSetting`: rejects `transaction_retention_years < 5` (AML/CFT minimum)
- SETTING_VALIDATORS: every key in SETTING_KEYS has a validator (compile-time exhaustiveness)

### Integration Tests (`admin.router.test.ts`)

- `POST /admin/team` → agent created → credentials email sent → audit logged
- `POST /admin/team/:id/deactivate` with active sellers → 422 with count
- `POST /admin/team/:id/deactivate` no active sellers → deactivated → audited
- `POST /admin/team/:id/reactivate` → reactivated → audited
- `POST /admin/team/:id/anonymise` → fields anonymised → audited
- `POST /admin/sellers/:id/reassign` → agentId updated → both agents notified → audited
- `POST /admin/settings/commission_amount` valid value → saved → audited
- `POST /admin/settings/commission_amount` with `-500` → 422
- `POST /admin/settings/transaction_retention_years` with `3` → 422 (min 5)
- `POST /admin/hdb/sync` → sync triggered → `hdb_sync.triggered_manually` audited
- Agent (non-admin) `GET /admin/team` → 403
- Agent (non-admin) `POST /admin/settings/:key` → 403
- Agent (non-admin) `GET /admin/sellers` → 403

---

## Audit Events Introduced

| Action | Trigger | Details |
|--------|---------|---------|
| `agent.created` | Create agent | `{ name, email, ceaRegNo, createdBy }` |
| `agent.deactivated` | Deactivate | `{ agentId, deactivatedBy, activeSellersCount: 0 }` |
| `agent.reactivated` | Reactivate | `{ agentId, reactivatedBy }` |
| `agent.anonymised` | Anonymise | `{ agentId, anonymisedBy }` |
| `lead.assigned` | Assign unassigned lead | `{ agentId, assignmentMethod: 'manual' }` |
| `lead.reassigned` | Reassign seller | `{ fromAgentId, toAgentId, reason: 'admin_reassignment' }` |
| `setting.changed` | Update setting | `{ key, oldValue, newValue, changedBy }` |
| `hdb_sync.triggered_manually` | Manual sync trigger | `{ triggeredBy }` |

---

## Out of Scope for SP3

- AuditLog schema migration (actorType, actorId, userAgent) → SP5
- Audit log viewer routes → SP5
- Analytics dashboard → SP4
