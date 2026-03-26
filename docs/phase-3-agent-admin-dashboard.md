# SellMyHouse.sg — Phase 3: Agent Dashboard, Admin Dashboard & Review Workflow
# Prerequisites: Phase 1 & 2 must be complete. Read phase-0-shared-context.md for schema reference.
# This phase builds: agent dashboard (pipeline, review queue, seller detail, compliance),
# human-in-the-loop review gates, complete audit trail (73 actions),
# admin dashboard (team management, analytics, system settings, audit log viewer, HDB data management),
# viewing calendar.

## Phase 3: Agent Dashboard & Review Workflow

### 3.1 Agent Dashboard
- **Pipeline overview:** Sellers by stage with counts and total value
- **Lead queue:** New leads, time since submission, notification status
- **Review queue:** Pending reviews (financial reports, listings, photos, updates) with priority sorting
- **Seller detail view:** Full property, timeline, documents, financials, notifications, compliance
- **Compliance dashboard:** CDD status, counterparty CDD, document status, consent status, retention deadlines
- **Notification center:** All sent notifications with delivery statuses

### 3.2 Human-in-the-Loop Review Gates
```
Status flow: draft | ai_generated | pending_review | approved | rejected | sent
Transitions enforced in code — cannot skip from ai_generated to sent.
```

**Items requiring review:** Financial reports, listing descriptions, seller photos, weekly updates, document checklists.

**Mandatory compliance gates (enforced in code, cannot be bypassed):**
1. CDD complete → before estate agency agreement
2. Estate agency agreement signed → before any marketing
3. Counterparty CDD complete → before OTP (for unrepresented buyers)
4. Agent OTP review confirmed → before OTP issued to buyer

### 3.3 Audit Trail
The audit trail is a critical compliance and accountability feature. Every significant action on the platform creates an `AuditLog` entry. Audit logs are **append-only** and **never deleted** — not even by admin.

**AuditLog record structure:**
```
{
  id,
  timestamp,          // auto-set on creation
  actorType,          // "seller" | "agent" | "admin" | "system" (for automated jobs)
  actorId,            // FK to the user who performed the action (nullable for system)
  action,             // standardized action string (see full list below)
  entityType,         // "seller" | "property" | "listing" | "offer" | "transaction" | "otp" | "invoice" | "cdd" | "consent" | "notification" | "agent" | "setting" | "hdbSync" | "video" | "content"
  entityId,           // FK to the affected entity
  details,            // JSON object with action-specific data (see below)
  ipAddress,          // request IP
  userAgent           // request user agent string
}
```

**Complete list of auditable actions — ALL must be implemented:**

**Lead & Seller Lifecycle:**
- `lead.created` — details: {name, phone, leadSource, consentService, consentMarketing}
- `lead.assigned` — details: {agentId, assignmentMethod: "auto"|"manual"}
- `lead.reassigned` — details: {fromAgentId, toAgentId, reason}
- `seller.status_changed` — details: {fromStatus, toStatus}
- `seller.archived` — details: {reason}
- `seller.deleted` — details: {reason, retentionPolicy: true|false}

**Consent & PDPA:**
- `consent.service_granted` — details: {consentText, ipAddress}
- `consent.marketing_granted` — details: {consentText, ipAddress}
- `consent.marketing_withdrawn` — details: {channel: "dashboard"|"email"|"phone", reason}
- `consent.service_withdrawn` — details: {channel, reason, transactionImpact}
- `data_access.requested` — details: {requestedBy: sellerId}
- `data_access.fulfilled` — details: {fulfilledBy: agentId, dataProvided: [list of data categories]}
- `data_correction.requested` — details: {field, currentValue, requestedValue}
- `data_correction.applied` — details: {field, oldValue, newValue, appliedBy: agentId}
- `data_retention.flagged` — details: {entityType, entityId, retentionPolicy, expiryDate}
- `data_deletion.approved` — details: {approvedBy: agentId, entityType, entityId}
- `data_deletion.executed` — details: {entityType, entityId, recordsDeleted}

**Property & Listing:**
- `property.created` — details: {town, flatType, block, street}
- `property.updated` — details: {changedFields: {field: {old, new}}}
- `property.status_changed` — details: {fromStatus, toStatus}
- `photos.uploaded` — details: {count, filePaths}
- `photos.reviewed` — details: {decision: "approved"|"rejected", reviewNotes, agentId}
- `listing.ai_generated` — details: {aiModel, promptVersion}
- `listing.reviewed` — details: {decision: "approved"|"rejected", reviewNotes, agentId}
- `listing.regenerated` — details: {reason, feedbackToAI, previousVersion}
- `portal_content.generated` — details: {portals: ["propertyguru", "99co", "srx"]}
- `portal_listing.posted` — details: {portal, portalUrl, postedBy: agentId}
- `listing.paused` — details: {reason}
- `listing.closed` — details: {reason}

**Compliance (CDD/AML):**
- `cdd.created` — details: {subjectType, subjectId, fullName}
- `cdd.identity_verified` — details: {verifiedBy: agentId, documentType}
- `cdd.risk_assessed` — details: {riskLevel: "standard"|"enhanced", assessedBy: agentId}
- `cdd.documents_uploaded` — details: {documentCount, documentTypes}
- `counterparty_cdd.created` — details: {buyerName, buyerPhone, isRepresented}
- `counterparty_cdd.verified` — details: {verifiedBy: agentId}

**Financial Reports:**
- `financial_report.generated` — details: {version, salePrice, netProceeds}
- `financial_report.reviewed` — details: {decision: "approved"|"rejected", reviewNotes, agentId}
- `financial_report.sent` — details: {sentVia: "whatsapp"|"email"|"both", recipientId}
- `financial_report.regenerated` — details: {reason, previousVersion}

**Offers & Negotiation:**
- `offer.received` — details: {buyerName, offerAmount, buyerAgentName}
- `offer.analysis_generated` — details: {offerVsMedian: percentage}
- `offer.analysis_reviewed` — details: {agentId}
- `offer.status_changed` — details: {fromStatus, toStatus, counterOfferAmount}

**OTP:**
- `otp.created` — details: {hdbSerialNumber}
- `otp.status_changed` — details: {fromStatus, toStatus}
- `otp.scanned_copy_uploaded` — details: {filePath}
- `otp.agent_review_confirmed` — details: {agentId, reviewNotes}
- `otp.reminder_sent` — details: {daysBeforeDeadline, channel}

**Transaction:**
- `transaction.created` — details: {propertyId, agreedPrice}
- `transaction.status_changed` — details: {fromStatus, toStatus}
- `hdb_application.submitted` — details: {submissionDate}
- `hdb_appointment.scheduled` — details: {appointmentDate}

**Commission Invoice:**
- `invoice.uploaded` — details: {filePath, invoiceNumber}
- `invoice.sent` — details: {sentVia, recipientId}
- `invoice.payment_recorded` — details: {paidAt, paymentMethod}

**Notifications:**
- `notification.sent` — details: {channel, templateName, recipientType, recipientId}
- `notification.delivered` — details: {channel, whatsappMessageId}
- `notification.failed` — details: {channel, error, willRetry}

**Authentication:**
- `auth.login` — details: {userType: "seller"|"agent"|"admin", userId}
- `auth.logout` — details: {userType, userId}
- `auth.login_failed` — details: {email, reason: "invalid_password"|"account_inactive"|"not_found"}
- `auth.password_changed` — details: {userId, userType}
- `auth.password_reset_requested` — details: {email}

**Agent Management (Admin):**
- `agent.created` — details: {name, email, ceaRegNo, createdBy: adminId}
- `agent.deactivated` — details: {agentId, deactivatedBy: adminId, reason, activeSellersCount}
- `agent.reactivated` — details: {agentId, reactivatedBy: adminId}

**System Settings (Admin):**
- `setting.changed` — details: {key, oldValue, newValue, changedBy: adminId}
- `hdb_sync.triggered_manually` — details: {triggeredBy: adminId}
- `hdb_sync.completed` — details: {recordsAdded, recordsTotal, status: "success"|"failed", error}

**Viewing Management:**
- `viewing.scheduled` — details: {viewerName, scheduledAt}
- `viewing.feedback_recorded` — details: {viewingId, feedbackSummary}

**Video/Content:**
- `video.created` — details: {title, category}
- `video.updated` — details: {title, changedFields}
- `video.deleted` — details: {title}
- `market_content.generated` — details: {contentType, dataRange}
- `market_content.reviewed` — details: {decision: "approved"|"rejected", agentId}

**Implementation notes:**
- Use an audit logging middleware (`middleware/audit.js`) that can be attached to any route
- For service-level actions (not triggered by HTTP request), the service function should call the audit logger directly with `actorType: "system"`
- The `details` JSON should capture enough information to reconstruct what happened WITHOUT needing to query other tables — because the referenced entities might be modified or deleted later
- Index `AuditLog` on: `actorType + actorId`, `entityType + entityId`, `action`, `timestamp`
- Admin Audit Log Viewer (section 3.4.5) must be able to filter on all of these fields

### 3.4 Admin Dashboard (role=admin only)
The admin dashboard is a superset of the agent dashboard. Admins see everything agents see, plus the following admin-only sections. All admin routes are protected by RBAC middleware that checks `role === 'admin'`. Regular agents cannot access admin routes.

**3.4.1 Team Overview (stub for MVP — build UI now, populate when team grows)**
- View all agents: name, CEA reg number, active/inactive status, number of active sellers, total completed transactions, total revenue generated
- Create new agent account (name, email, phone, CEA reg number → generates temporary password → sends login credentials via email)
- Deactivate agent account (sets `isActive: false`, agent cannot log in, sellers remain assigned — admin must reassign before deactivation if agent has active sellers)
- Reactivate deactivated agent
- Remove agent from platform (anonymise: name → "Former Agent [ID]", email/phone → null, retain record for audit log referential integrity — this is anonymisation, not soft delete)
- View any agent's full pipeline (same view as the agent sees, but admin can see all agents)

**3.4.2 Lead & Seller Management**
- View all sellers across all agents in a single filterable table
- Filter by: agent, status, town, date range, lead source
- Reassign a seller from one agent to another (select new agent from dropdown → confirm → update `agentId` → notify both agents → audit log)
- Manual lead assignment: when a new lead comes in, admin can assign to any agent (for future round-robin or geography-based distribution)

**3.4.3 Analytics Dashboard**
Build a reporting dashboard with the following views. All data should be filterable by date range (default: last 30 days) and by agent (default: all agents).

**Revenue:**
- Total revenue (completed transactions × $1,633.91)
- Revenue by month (bar chart, last 12 months)
- Revenue by agent (table, when team grows)
- Revenue projection (current pipeline value: active transactions × $1,633.91)
- Invoices pending payment count and total

**Transaction Volume:**
- Total transactions by status (funnel: leads → engaged → listed → offer → OTP → completed)
- Conversion rate at each stage (leads to engaged %, engaged to listed %, etc.)
- Transactions completed this month vs last month vs same month last year
- Transactions by town (heatmap or bar chart — shows which towns generate most business)

**Time-to-Close:**
- Average days from lead to completion (overall and by agent)
- Average days at each stage (how long do listings sit before getting an offer? how long from offer to OTP?)
- Breakdown by flat type (do executive flats take longer than 4-room?)
- Trend over time (is the process getting faster or slower?)

**Lead Sources:**
- Leads by source: website report tool, TikTok, Instagram, referral, walk-in, other
- Conversion rate by source (which source produces leads that actually complete?)
- Cost per acquisition by source (if tracking ad spend in future)
- Lead volume trend by source over time

**Viewings:**
- Total viewings this month vs last month (with trend arrow)
- Viewings by listing (ranked — which properties are getting the most interest, which are cold?)
- Viewings funnel: viewings → offers received → offers accepted → transactions completed (with conversion rates at each step)
- Average viewings before first offer is received (per listing and overall — "it takes an average of 8 viewings to get an offer")
- Busiest days of week (bar chart — e.g., Saturday is 45% of all viewings)
- Busiest time slots (heatmap — helps advise sellers on optimal slot availability)
- Viewer type breakdown: buyers vs agents (pie chart — shows what % of viewings come from represented vs unrepresented buyers)
- No-show rate: overall and by listing (high no-show rate on a listing may indicate pricing or listing quality issues)
- Repeat viewers: verified viewers who have booked viewings for 2+ listings (these are your hottest buyer leads — show as a ranked list with name, phone, number of properties viewed, last viewing date)
- Viewing-to-offer timeline: average days from first viewing on a listing to first offer (is the market responding quickly or slowly?)
- Cancellation rate: % of bookings cancelled before viewing (high rate may indicate listing presentation issues)

**3.4.4 System Settings Panel**
Admin UI to manage platform configuration without touching environment variables or database directly. Read/write from `SystemSetting` table.

**Settings categories:**

*Pricing:*
- Commission amount (default: 1499)
- GST rate (default: 0.09)
- Display/list price (default: 1999 — the "was" price shown on the website)

*OTP & Transaction:*
- Default OTP exercise period in days (default: 21)
- Reminder schedule: days before OTP deadline to send reminders (default: [14, 7, 3, 1])

*Notifications:*
- WhatsApp enabled/disabled toggle
- Email enabled/disabled toggle
- WhatsApp message templates (view only — must be registered with Meta separately, but display current template names and status here)
- Post-completion sequence timing: thank-you delay (default: 1 day), testimonial request delay (default: 7 days), buyer follow-up delay (default: 14 days)

*Data & Sync:*
- HDB data sync schedule (cron expression, default: weekly Sunday midnight)
- Trigger manual HDB data sync (button → runs `hdbDataSync` job immediately)
- View last sync status, records added, last sync timestamp
- Data retention periods: lead retention months, transaction retention years

*Platform:*
- Agent portal listing formats: enable/disable which portals appear in portal-ready output (PropertyGuru, 99.co, SRX)
- Video tutorial management (CRUD — covered in Phase 6, but link to it from settings)

All setting changes are logged in `AuditLog` with the old value and new value.

**3.4.5 Audit Log Viewer (Admin Only)**
- Searchable, filterable view of ALL audit log entries across ALL agents and sellers
- Filter by: date range, agent, seller, action type (approval/rejection/upload/consent/login/setting_change/etc.), entity type
- Export to CSV for compliance reporting
- Cannot delete or modify audit log entries (read-only, append-only)

**3.4.6 HDB Data Management**
- View current HDB data status: total records, date range covered, last sync
- Trigger manual sync from data.gov.sg
- View sync history (last 20 syncs with status, records added, errors)
- Upload new CSV file manually (fallback if data.gov.sg API changes)

### Tests for Phase 3:
```
Unit Tests:
- Review gate state machine: all valid/invalid transitions
- RBAC: agent sees only assigned sellers
- RBAC: admin sees all agents and all sellers
- RBAC: agent cannot access admin routes (settings, team management, full audit log)
- Compliance gates: listing blocked without CDD, OTP blocked without counterparty CDD
- Settings service: reads settings from database with correct defaults
- Settings service: validates setting values before saving (e.g., commission must be positive number)
- Analytics: revenue calculation correct (completed transactions × $1,633.91)
- Analytics: conversion rate calculation correct (stage N count / stage N-1 count)
- Analytics: time-to-close calculation correct (completion date - lead created date)

Integration Tests:
- Agent approves/rejects → status change → audit log
- Compliance gate enforcement end-to-end
- Consent withdrawal → marketing stops → agent notified
- Admin creates agent account → agent receives credentials → can log in
- Admin deactivates agent → agent cannot log in → sellers not deleted
- Admin reassigns seller → agentId updated → both agents notified → audit logged
- Admin updates system setting → old/new values logged in audit → setting takes effect
- Admin views analytics → correct aggregations returned
- Admin views audit log → sees all entries across all agents
- Admin triggers HDB sync → job runs → sync logged → data updated
- Regular agent cannot access admin settings endpoint (403)
- Regular agent cannot access team management endpoint (403)
- Regular agent cannot access full audit log endpoint (403)

E2E Tests:
- Full flow: lead → engagement → photos → listing → approval
- Reject and regenerate flow
- Admin: create agent → assign lead → agent sees lead in their pipeline
- Admin: reassign seller from agent A to agent B → agent B sees seller
- Admin: change commission amount in settings → financial calculator uses new amount
- Admin: analytics dashboard loads with correct data
```

