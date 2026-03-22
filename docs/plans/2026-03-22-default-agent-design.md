# Default Agent for Lead Assignment

**Date:** 2026-03-22
**Status:** Approved

## Overview

Add a "Set Default" action to the `/admin/team` page. When set, all new leads submitted via the public form are automatically assigned to that agent at creation time. There can only be one default at a time. The admin can change or clear the default at any time.

## Data Layer

**Storage:** `SystemSetting` table, key `default_agent_id`.
- Value: agent UUID string
- Absent or empty string = no default (leads created unassigned as today)
- Added to `SETTING_KEYS` in `src/domains/shared/settings.types.ts`
- No schema migration required

**Lead auto-assignment** (`lead.service.ts → submitLead`):
- After atomic seller+consent creation, read `settingsService.get('default_agent_id', '')`
- If non-empty, call `leadRepo.assignAgent(seller.id, agentId)`
- Audit log: `lead.auto_assigned` with `{ agentId, reason: 'default_agent' }`

## Admin UI

**Team list** (`partials/admin/team-list.njk`):
- Router passes `defaultAgentId` alongside `team` array
- If `member.id === defaultAgentId`, show an indigo "Default" pill badge next to the agent name
- Active agents who are not currently the default show a **"Set Default"** text button (indigo) in the Actions column

**Set Default button:**
- `hx-post="/admin/team/:id/set-default"`, `hx-target="#action-result"`
- No confirm dialog (non-destructive)
- Response: re-renders `partials/admin/team-list` with updated `defaultAgentId` + success message in `#action-result`

**Deactivate/Anonymise guard modal** (`partials/admin/reassign-default-modal.njk`):
- Triggered when admin deactivates or anonymises the current default agent without supplying a replacement
- Shows: dropdown of remaining active agents + "Unassigned" option
- On submit: posts `newDefaultAgentId` (UUID or `"unassigned"`) to the original deactivate/anonymise route

## Backend Routes

### New: `POST /admin/team/:id/set-default`
1. Validate agent exists and is active
2. `adminService.setDefaultAgent(agentId, actingAdminId)`
   - `settingsService.upsert('default_agent_id', agentId, 'Default agent for new lead assignment', actingAdminId)`
   - Audit log: `agent.set_as_default`
3. HTMX: re-render `partials/admin/team-list` with updated `defaultAgentId`

### Modified: `POST /admin/team/:id/deactivate` and `POST /admin/team/:id/anonymise`
- Accept optional body param `newDefaultAgentId` (UUID or `"unassigned"`)
- If agent is current default **and** `newDefaultAgentId` is absent → return `partials/admin/reassign-default-modal` (HTTP 200, no action taken yet)
- If `newDefaultAgentId` is a UUID → `setDefaultAgent(newDefaultAgentId)` then proceed with deactivate/anonymise
- If `newDefaultAgentId === "unassigned"` → delete/clear `default_agent_id` setting then proceed

### Modified: `adminService.getTeam()`
- Fetches `default_agent_id` setting alongside team array
- Returns `{ team: AgentSummary[], defaultAgentId: string | null }`

## Testing

### Unit tests (`admin.service.test.ts`)
- `setDefaultAgent`: happy path, agent not found, agent inactive
- `submitLead` with default set: `assignAgent` called with correct agentId
- `submitLead` with no default: `assignAgent` not called
- `deactivateAgent` when agent is default, no replacement: returns modal trigger flag
- `deactivateAgent` with `newDefaultAgentId` UUID: updates default then deactivates
- `deactivateAgent` with `newDefaultAgentId = "unassigned"`: clears setting then deactivates

### Integration tests (`admin.router.test.ts`)
- `POST /admin/team/:id/set-default` → 200, team-list partial contains Default badge
- `POST /admin/team/:id/deactivate` (agent is default, no body) → modal partial returned, agent still active
- `POST /admin/team/:id/deactivate` (with `newDefaultAgentId`) → deactivates + updates default
- Lead submission with default agent set → seller row has `agentId` populated
