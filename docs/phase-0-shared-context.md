# SellMyHouse.sg — Shared Context
# Include this context at the start of EVERY phase session with Claude Code.
# It provides the project overview, tech stack, schema, and cross-cutting concerns
# that all phases need to reference.

# SellMyHouse.sg — Claude Code Build Prompt

## Project Overview

Build **sellmyhouse.sg**, a standalone, AI-powered web platform for high-volume, low-cost HDB resale property transactions in Singapore. The platform operates under Huttons Asia Pte Ltd (CEA Licence No. L3008899K) and charges a fixed fee of $1,499 + GST per transaction (listed as $1,999, discounted to $1,499).

The platform serves three user types:
1. **Sellers** — HDB homeowners who want to sell their flat. They take their own photos, conduct their own viewings, and learn the process through video tutorials. The platform guides them and handles the complex parts.
2. **Buyers** — Stub for now. Schema and basic models only. No buyer dashboard or buyer workflow in MVP. Will be built later.
3. **Agents** — Licensed real estate salespersons (starting with one solo agent, scaling to a team later) who review all AI outputs, handle negotiations, manage compliance, and approve critical documents before they reach clients.

This is a standalone platform. It does NOT integrate with the agent's existing CRM (crm.sandyhorse.com). They are separate systems.

---

## Tech Stack

- **Runtime:** Node.js (LTS)
- **Backend Framework:** Express.js
- **Database:** PostgreSQL
- **ORM:** Prisma
- **Frontend:** Server-rendered views (EJS or similar) for the public site; React (or Preact) for the seller and agent dashboards
- **Authentication:** Passport.js with session-based auth (sellers) + separate agent auth with role-based access control
- **File Storage:** Local filesystem on VPS, organized under `/uploads/` with subdirectories per seller/property. Abstract file operations behind a storage service for future cloud migration.
- **AI Integration:** Provider-agnostic AI abstraction layer. Default provider: Anthropic Claude API. Must support swapping to OpenAI GPT, Google Gemini, or other providers without changing application code. See AI Architecture section below.
- **Messaging:** Meta WhatsApp Business API (agent has existing Meta Business account) + Nodemailer for email + in-app notification system
- **Testing:** Jest (unit + integration), Supertest (API), Playwright (E2E)
- **CSS:** Tailwind CSS
- **Build Tool:** Vite (for dashboard frontend)
- **PWA:** Progressive Web App — installable on mobile home screens, works offline for cached content, responsive across all devices
- **Deployment:** Hostinger VPS (Singapore region), nginx reverse proxy, PM2 process manager, Let's Encrypt SSL

---

## Database Schema (Prisma)

Design the schema to support these core entities:

### Users & Auth
- `Agent` — id, name, email, phone, ceaRegNo, passwordHash, role (admin/agent), isActive (bool, default true), createdAt, updatedAt
- `Seller` — id, name, email, phone, passwordHash, agentId (FK), status (lead/engaged/active/completed/archived), consentService (bool), consentMarketing (bool), consentTimestamp, consentWithdrawnAt (nullable), leadSource (nullable — website/tiktok/instagram/referral/walkin/other), createdAt, updatedAt
- `Buyer` — id, name, email, phone, passwordHash, agentId (FK), status, consentService, consentMarketing, consentTimestamp, consentWithdrawnAt, createdAt, updatedAt
  - **Note: Buyer is a stub. Create the model and basic CRUD but no dashboard or workflows yet.**

### Property & Listing
- `Property` — id, sellerId (FK), town, street, block, flatType, storeyRange, floorAreaSqm, flatModel, leaseCommenceDate, remainingLease, askingPrice, status (draft/listed/offer_received/under_option/completing/completed/withdrawn), createdAt, updatedAt
- `Listing` — id, propertyId (FK), title, description, descriptionApprovedByAgentId (FK, nullable), descriptionApprovedAt (nullable), photos (JSON array of file paths), photosApprovedByAgentId (FK, nullable), photosApprovedAt (nullable), status (draft/pending_review/approved/live/paused/closed), createdAt, updatedAt
- `PortalListing` — id, listingId (FK), portalName (enum: propertyguru/99co/srx/other), portalReadyContent (JSON — structured output formatted for that portal's fields: title, description, photos, flat details, CEA details), postedManuallyAt (nullable, agent marks when they've posted it), portalListingUrl (nullable, agent pastes the live URL), status (ready/posted/expired), createdAt, updatedAt
- `VerifiedViewer` — id, name, phone (unique), phoneVerifiedAt, viewerType (enum: buyer/agent), agentName (nullable), agentCeaReg (nullable), agentAgencyName (nullable), consentService (bool), totalBookings (int, default 0), lastBookingAt (nullable), createdAt, updatedAt
  - One record per unique verified phone number. Persists across all bookings and listings.
- `Viewing` — id, propertyId (FK), viewingSlotId (FK), verifiedViewerId (FK), cancelToken (string — unique token for one-click cancellation link), status (pending_otp/scheduled/completed/cancelled/no_show), scheduledAt, completedAt (nullable), feedback (text, nullable — seller records after viewing), createdAt
- `ViewingSlot` — id, propertyId (FK), date, startTime, endTime, durationMinutes (int — default from SystemSetting `viewing_slot_duration`, default 15), slotType (enum: single/group — seller chooses per slot), maxViewers (int — 1 for single, configurable for group, default 5), currentBookings (int, default 0), status (available/booked/full/cancelled), createdAt

### Transaction & Offers
- `Offer` — id, propertyId (FK), buyerName, buyerPhone, buyerAgentName (nullable), buyerAgentCeaReg (nullable), isCoBroke (bool — true if buyer has own agent), offerAmount, status (pending/countered/accepted/rejected/expired), notes, createdAt, updatedAt
- `Transaction` — id, propertyId (FK), sellerId (FK), buyerId (FK, nullable), agreedPrice, optionFee, optionDate, exerciseDeadline, exerciseDate (nullable), completionDate (nullable), status (option_issued/option_exercised/completing/completed/fallen_through), createdAt, updatedAt
- `Otp` — id, transactionId (FK), hdbSerialNumber (string — the unique serial number from HDB's physical OTP form), status (prepared/sent_to_seller/signed_by_seller/returned/issued_to_buyer/exercised/expired), scannedCopyPath (nullable — file path to uploaded scanned PDF/image of signed OTP), scannedCopyDeletedAt (nullable), agentReviewedAt (nullable), agentReviewNotes (nullable), preparedAt, issuedAt (nullable), exercisedAt (nullable), expiredAt (nullable), createdAt, updatedAt
- `CommissionInvoice` — id, transactionId (FK), invoiceFilePath (string — uploaded PDF from Huttons), invoiceDeletedAt (nullable), invoiceNumber (nullable — Huttons invoice reference), amount (always 1499), gstAmount (always 134.91), totalAmount (always 1633.91), status (pending_upload/uploaded/sent_to_client/paid), uploadedAt (nullable), sentAt (nullable), sentVia (nullable — whatsapp/email/both), paidAt (nullable), createdAt, updatedAt
- `EstateAgencyAgreement` — id, sellerId (FK), agentId (FK), agreementType (enum: non_exclusive/exclusive — default non_exclusive for this platform), formType (string — "CEA Form 1" for sale), commissionAmount (1499), commissionGstInclusive (bool), coBrokingAllowed (bool — always true, per CEA guidelines), coBrokingTerms (text — "Co-broking welcomed. Commission is not shared. Buyer's agent is paid by their own client."), signedAt (nullable), signedCopyPath (nullable — uploaded scan of signed agreement), signedCopyDeletedAt (nullable), videoCallConfirmedAt (nullable — timestamp when agent confirmed seller understanding via video call), videoCallNotes (nullable), expiryDate (nullable — for exclusive agreements; non-exclusive has no expiry), status (draft/sent_to_seller/signed/active/terminated/expired), createdAt, updatedAt

### Financial
- `FinancialReport` — id, sellerId (FK), propertyId (FK), reportData (JSON — contains all calculation inputs and outputs), aiNarrative (text, nullable — AI-generated plain language summary), aiProvider (string, nullable — which AI provider generated this: "anthropic"|"openai"|"google"|etc), aiModel (string, nullable — specific model used: "claude-sonnet-4-20250514"|"gpt-4o"|etc), generatedAt, reviewedByAgentId (FK, nullable), reviewedAt (nullable), reviewNotes (nullable), approvedAt (nullable), sentToSellerAt (nullable), sentVia (nullable — whatsapp/email/in_app), version (int), createdAt

### Compliance
- `CddRecord` — id, subjectType (seller/buyer/counterparty), subjectId, fullName, nricLast4, dateOfBirth, nationality, occupation, riskLevel (standard/enhanced), identityVerified (bool), verifiedByAgentId (FK), verifiedAt, documents (JSON array — file paths to stored encrypted ID copies), notes, createdAt, updatedAt
- `ConsentRecord` — id, subjectType (seller/buyer), subjectId, purposeService (bool), purposeMarketing (bool), consentGivenAt, consentWithdrawnAt (nullable), withdrawalChannel (nullable), ipAddress, userAgent, createdAt
- `AuditLog` — id, agentId (FK, nullable), action (string), entityType, entityId, details (JSON), ipAddress, createdAt

### Notifications
- `Notification` — id, recipientType (seller/agent), recipientId, channel (whatsapp/email/in_app), templateName (string), content (text), status (pending/sent/delivered/failed/read), sentAt (nullable), deliveredAt (nullable), readAt (nullable), whatsappMessageId (nullable — Meta API message ID for delivery tracking), error (nullable), createdAt

### Content
- `VideoTutorial` — id, title, slug, description, youtubeUrl, category (photography/forms/process/financial), orderIndex, createdAt

### HDB Reference Data
- `HdbTransaction` — id, month, town, flatType, block, streetName, storeyRange, floorAreaSqm, flatModel, leaseCommenceDate, remainingLease, resalePrice, source (enum: csv_seed/datagov_sync), createdAt
- `HdbDataSync` — id, syncedAt, recordsAdded (int), recordsTotal (int), source (string — data.gov.sg dataset ID), status (success/failed), error (nullable), createdAt

### System Configuration
- `SystemSetting` — id, key (unique string), value (text — JSON-serializable), description (text), updatedByAgentId (FK), updatedAt, createdAt
  - Seed with default settings:
    - `commission_amount`: 1499
    - `gst_rate`: 0.09
    - `otp_exercise_days`: 21
    - `lead_retention_months`: 12
    - `transaction_retention_years`: 5
    - `ai_provider`: "anthropic"
    - `ai_model`: "claude-sonnet-4-20250514"
    - `ai_max_tokens`: 2000
    - `ai_temperature`: 0.3
    - `viewing_slot_duration`: 15 (minutes)
    - `viewing_max_group_size`: 5
    - `hdb_sync_schedule`: "0 0 * * 0" (cron: Sunday midnight)
    - `reminder_schedule`: "0 9 * * *" (cron: daily 9am)
    - `market_content_schedule`: "0 8 * * 1" (cron: Monday 8am)
    - `whatsapp_enabled`: true
    - `email_enabled`: true
  - All setting changes logged in `AuditLog`

---

## Additional Schema Models

Add these to the Database Schema section:

### Testimonials & Referrals
- `Testimonial` — id, sellerId (FK), transactionId (FK), content (text), rating (int 1-5), sellerName (display name, may differ from legal name), sellerTown (string — for display: "Seller in Tampines"), status (pending_review/approved/rejected), approvedByAgentId (FK, nullable), approvedAt (nullable), displayOnWebsite (bool, default false), createdAt
- `Referral` — id, referrerSellerId (FK — the seller who referred), referralCode (unique string), referredName (nullable), referredPhone (nullable), referredSellerId (FK, nullable — links to the new seller if they sign up), status (link_generated/clicked/lead_created/transaction_completed), clickCount (int, default 0), createdAt, convertedAt (nullable)

### Complex Case Tracking
- `CaseFlag` — id, sellerId (FK), flagType (enum: deceased_estate/divorce/mop_not_met/eip_restriction/pr_quota/bank_loan/court_order/other), description (text — agent's notes on the situation), status (identified/in_progress/resolved/out_of_scope), guidanceProvided (text, nullable — what instructions were given to the seller), resolvedAt (nullable), createdAt, updatedAt

### Seller Preferences
- Add to `Seller` model: `notificationPreference` (enum: whatsapp_and_email/email_only — default whatsapp_and_email)

### Property Updates
- Add to `Property` model: `priceHistory` (JSON array — [{price, changedAt, changedBy}] — tracks all asking price changes)
- Add to `Listing` model: when property price changes while listing is live, listing status auto-reverts to `pending_review` for agent to re-approve

---

## Cross-Cutting Concerns

### Security
bcrypt (cost 12), HTTPS (nginx + Let's Encrypt), CSRF, rate limiting (see below), input sanitization (express-validator), Prisma parameterized queries, XSS prevention + CSP headers, file upload validation (jpg/jpeg/png/pdf only, 5MB photos, 10MB docs), secure sessions (httpOnly, secure, sameSite: strict), Helmet.js, WhatsApp webhook signature validation.

**Rate limiting (consistent across application and nginx):**
- Login/auth endpoints: 5 attempts per 15 minutes per IP (application-level via express-rate-limit)
- API endpoints: 100 requests per minute per IP (application-level)
- nginx layer (additional defense): 10 requests/second burst for API, 5 requests/minute for login
- Lead capture form: 3 submissions per hour per IP (prevent spam)
- HDB report tool: 20 requests per minute per IP (generous — this is the lead magnet)
- WhatsApp webhook: no rate limit (Meta controls the send rate)

### Error Handling
Global handler, structured responses, no stack traces to client, critical errors notify agent.

### Logging
Pino (structured JSON), request logging, database-backed audit log (never deleted), PM2 log rotation.

### Environment Configuration
`.env` with: DATABASE_URL, SESSION_SECRET, AI_ANTHROPIC_API_KEY, AI_OPENAI_API_KEY (optional), AI_GOOGLE_API_KEY (optional), WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_VERIFY_TOKEN, SMTP config, ENCRYPTION_KEY (AES-256), DATAGOV_API_KEY. Only the active AI provider's key is required. Separate dev/test/prod configs. Never commit secrets.

### Scheduled Jobs (node-cron)
All job schedules are configurable via the admin System Settings panel (stored in `SystemSetting` table). Defaults:
- `hdbDataSync` — Sunday midnight SGT
- `reminders` — daily 9am SGT: OTP exercise deadlines, HDB appointment reminders, viewing day morning reminders (consolidated per seller)
- `viewingAlerts` — every 15 minutes: 1-hour-before viewing reminders, post-viewing feedback prompts
- `retention` — Saturday midnight SGT
- `marketContent` — Monday 8am SGT

The financial calculation engine should read `commission_amount` and `gst_rate` from `SystemSetting` at runtime, not from hardcoded constants. This allows the admin to update pricing without redeploying.

---

## Testing Strategy

### Unit Tests (Jest): `npm test`
All services in isolation, mocked DB/API calls, validators, formatters, financial calculations, PDPA helpers, RBAC, review gate state machine, portal formatter, notification logic, file encryption, AI provider routing and prompt template generation.

### Integration Tests (Jest + Supertest): `npm run test:integration`
API endpoints with test database, auth flows, RBAC enforcement, review gates, consent management, notification dispatch (mocked APIs), OTP workflow, invoice flow. Seed before, clean after.

### E2E Tests (Playwright): `npm run test:e2e`
Chrome + mobile viewport. Journeys: visitor report tool, seller dashboard, agent review flow, portal content copy, OTP lifecycle, invoice upload, full transaction lifecycle, admin team management, admin analytics dashboard, admin settings panel.

### Regression Tests
20+ financial calculation edge cases. Notification delivery suite (success, failure, fallback, consent blocking). Run on every commit.

### Test Data (`tests/fixtures/`)
Sample HDB CSV (100 records), 10 seller profiles (various scenarios), 20+ financial calculation I/O pairs, consent records, OTP lifecycle data, mock WhatsApp API responses, mock AI provider responses (fixture outputs for each prompt template).

---

## Deployment & Server Hardening (Hostinger VPS)

### Server Setup
Ubuntu LTS, Singapore region (PDPA data residency). nginx reverse proxy, PM2 process manager.

### Server Hardening (execute during initial VPS setup)

**SSH Hardening:**
- Disable root login: `PermitRootLogin no` in `/etc/ssh/sshd_config`
- Disable password authentication: `PasswordAuthentication no` — use SSH key pairs only
- Change default SSH port from 22 to a non-standard port (e.g., 2222): `Port 2222`
- Limit SSH access to specific user: `AllowUsers deployer`
- Set idle timeout: `ClientAliveInterval 300`, `ClientAliveCountMax 2`
- Restart SSH after changes: `systemctl restart sshd`

**Firewall (UFW):**
```
ufw default deny incoming
ufw default allow outgoing
ufw allow 2222/tcp    # SSH (non-standard port)
ufw allow 80/tcp      # HTTP (for Let's Encrypt redirect)
ufw allow 443/tcp     # HTTPS
ufw enable
```
- No other ports open. PostgreSQL listens on localhost only (not exposed to internet).

**Fail2ban:**
- Install and configure for SSH brute force protection
- Also configure for nginx (block repeated 401/403 responses)
- Ban time: 1 hour after 5 failed attempts
- Email notification on ban events (optional)

**Non-root application user:**
- Create a dedicated user for running the application: `adduser smh`
- Application runs as `smh` user, NOT root
- PM2 runs under `smh` user
- Application files owned by `smh` with restricted permissions

**File permissions:**
```
# Application code: owner read/write, group read, others no access
chmod -R 750 /home/smh/sellmyhouse/
chown -R smh:smh /home/smh/sellmyhouse/

# Upload directories: owner read/write only
chmod -R 700 /home/smh/sellmyhouse/uploads/
chmod -R 700 /home/smh/sellmyhouse/uploads/documents/  # CDD docs — most sensitive

# Environment file: owner read only
chmod 400 /home/smh/sellmyhouse/.env

# Logs: owner read/write, group read
chmod -R 750 /home/smh/.pm2/logs/
```

**Automatic security updates:**
- Enable unattended-upgrades for security patches: `apt install unattended-upgrades`
- Configure to auto-install security updates only (not feature updates)
- Node.js: subscribe to Node.js security mailing list, update promptly when security releases are published
- npm: run `npm audit` weekly, fix critical/high vulnerabilities immediately

### SSL/TLS (Let's Encrypt)
- Certbot with nginx plugin for automatic certificate management
- Auto-renewal via systemd timer or cron
- nginx config: redirect all HTTP to HTTPS, HSTS header, disable TLS 1.0/1.1
- Strong cipher suite configuration

### nginx Hardening
```nginx
# Hide server version
server_tokens off;

# Security headers (in addition to Helmet.js)
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' fonts.googleapis.com; font-src 'self' fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-src www.youtube.com;" always;

# Rate limiting at nginx level
limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
limit_req_zone $binary_remote_addr zone=login:10m rate=5r/m;

# Block common attack patterns
location ~* /(\.git|\.env|\.htaccess|wp-admin|wp-login|phpmyadmin) {
    deny all;
    return 404;
}

# Block direct access to uploads directory (serve through application route with auth)
location /uploads/ {
    deny all;
    return 403;
}
```

### Database Security
- PostgreSQL listens on localhost only (`listen_addresses = 'localhost'` in postgresql.conf)
- Database user for the application has minimum required privileges (no SUPERUSER, no CREATEDB)
- Separate database for production and testing — never share
- Connection via Unix socket or localhost TCP, never exposed to network
- Regular automated backups: `pg_dump` daily, retain 30 days, encrypted before offsite transfer

### Application-Level File Protection
- **Uploads served through application routes, NOT directly by nginx.** Files in `/uploads/` are never publicly accessible. The application checks authentication and authorization before serving any file.
- **CDD documents (NRIC copies, identity documents):** encrypted at rest with AES-256. Even if an attacker gains filesystem access, encrypted files are unreadable without the encryption key (stored in `.env`, which has 400 permissions).
- **Environment file (`.env`):** contains all secrets (API keys, encryption key, database credentials). Permissions: `chmod 400` (owner read only). Not in version control (`.gitignore`).
- **Upload path traversal prevention:** validate all filenames, reject path separators (`../`), use UUID-based filenames instead of user-supplied names.

### Intrusion Detection & Monitoring
- **AIDE (Advanced Intrusion Detection Environment):**
  - Install AIDE for filesystem integrity monitoring
  - Initialize baseline: `aide --init` after deployment
  - Daily cron job: `aide --check` compares current filesystem against baseline
  - Alerts on any unauthorized changes to application files, config files, or system binaries
  - After legitimate deployments: update baseline with `aide --update`
- **Logwatch or GoAccess:**
  - Daily log analysis reports emailed to admin
  - Flag suspicious patterns: repeated 403s, unusual request paths, high error rates
- **PM2 monitoring:**
  - Monitor CPU/memory usage, restart count, uptime
  - Alert if application crashes repeatedly (possible attack or bug)
- **Database audit:**
  - PostgreSQL logs all connections and failed authentication attempts
  - Log slow queries (>1 second) for performance monitoring

### Backup Strategy
- **Database:** daily `pg_dump`, compressed, retained 30 days locally + weekly offsite
- **Uploads:** daily rsync to backup location, encrypted for offsite transfer
- **Application code:** Git repository is the source of truth (not the VPS copy)
- **.env file:** stored separately in a secure password manager (not backed up to offsite storage with other files)
- **Test backup restoration quarterly** — a backup you've never tested is not a backup

### Incident Response
- If a breach is suspected:
  1. Immediately revoke all API keys (AI providers, WhatsApp, email) and rotate secrets
  2. Take the application offline if necessary
  3. Preserve logs (do not delete — they're evidence)
  4. Assess scope: which data was potentially accessed?
  5. If personal data of 500+ individuals potentially affected OR likely significant harm: notify PDPC within 72 hours (PDPA breach notification obligation)
  6. Notify affected individuals as soon as practicable
  7. Document everything in the incident response log

### CI/CD
- Git-based deployment: push to main → SSH into VPS → pull → install → migrate → restart
- Pre-deploy: run `npm test` and `npm run test:integration` locally or in CI
- Deploy script: `git pull && npm ci && npx prisma migrate deploy && pm2 restart sellmyhouse`
- Rollback: keep last 3 deployments via git tags, quick rollback script
- Post-deploy: verify application is responding, check PM2 status, check error logs

---

## Stubs (Build Later)

**Buyer Side:** Schema in place, no dashboard/workflow. Placeholder "Coming Soon" in agent dashboard.

**Advanced Team Management:** Basic admin capabilities are built (create/deactivate agents, view pipelines, reassign sellers, analytics). Future additions stubbed as "Coming Soon": automated lead round-robin distribution, geography-based lead routing, commission split tracking, team performance leaderboards, agent onboarding workflow with training checklist.

**Multi-Language Support:** MVP is English only. Future addition: support for Chinese (Simplified), Malay, and Tamil to serve Singapore's multilingual population. Architecture note: use i18n library (e.g., `i18next`) from the start and wrap all user-facing strings in translation functions, even if only English translations exist initially. This avoids a painful retrofit later. Placeholder "Language" selector in footer/settings marked "Coming Soon."

---

## Regulatory Reference

- Estate Agents Act 2010, CEA Ethical Advertising PG 2/2011, CEA Forms PG 1/2011, CEA OTP Guidelines PG 1-2021, AML/CFT Regulations 2021 (amended July 2025), PDPA 2012, PDPC Real Estate Sector Guidelines (2014), PDPC NRIC Guidelines (2018), DNC Provisions.
- Official sources: www.hdb.gov.sg, www.cpf.gov.sg, www.ura.gov.sg

---

## Important Constraints

1. **No financial advice.** Estimates only. Every output includes disclaimers.
2. **No formal valuations.** Indicative ranges from public data only.
3. **Human-in-the-loop is mandatory.** Enforced in code. No AI output reaches client without agent approval.
4. **PDPA consent is granular.** Service and marketing always separate. Marketing never pre-ticked. Consent records immutable (append-only).
5. **Audit everything.** Every significant action logged. Audit logs never deleted.
6. **Commission is fixed.** $1,499 + GST ($1,633.91). Never percentage-based.
7. **OTP is physical.** Platform tracks status and stores scanned copies. Does not generate or modify the OTP.
8. **Commission invoice comes from Huttons.** Platform stores and distributes only.
9. **No direct portal API integration.** Platform generates portal-ready content for manual posting. PropertyGuru, 99.co, SRX do not offer public listing creation APIs.
10. **Three-channel notifications.** WhatsApp (primary), email (fallback), in-app. Marketing requires explicit consent.

## Technical Addendum

### Data Integrity Rules (enforce in code)

1. **Agent deactivation guard:** Admin cannot deactivate an agent who has any sellers with status other than `completed` or `archived`. System returns error: "This agent has [N] active sellers. Reassign them before deactivating."

2. **ViewingSlot cancellation cascade:** When seller cancels a ViewingSlot that has confirmed bookings:
   - All `Viewing` records for that slot auto-update to `cancelled`
   - All booked viewers notified (WhatsApp + email)
   - `ViewingSlot.currentBookings` reset to 0

3. **Property edit on live listing:** When seller edits any property field while listing is `live`:
   - Listing status reverts to `pending_review`
   - Agent notified: "Seller updated [changed fields]. Listing requires re-review."
   - Portal listings marked as needing update

4. **Concurrent booking race condition:** Use database-level row locking (Prisma `$transaction` with `SELECT FOR UPDATE` on ViewingSlot) to prevent two buyers booking the last single slot simultaneously.

5. **Transaction fallen-through cascade:** When transaction status → `fallen_through`:
   - Listing → `draft`
   - Property → `draft`
   - Active viewing slots → `cancelled` (with viewer notifications)
   - OTP → `expired` if still active
   - Transaction record preserved for history

### Image Optimization
- On upload: resize photos to max 2000px on longest edge, compress to JPEG quality 80 (target ~500KB per image)
- Store both original and optimized versions: `/uploads/photos/{sellerId}/{propertyId}/original/` and `/uploads/photos/{sellerId}/{propertyId}/optimized/`
- Portal-ready content uses optimized versions
- Use `sharp` npm package for image processing
- Validate image dimensions: reject photos smaller than 800px on longest edge (too low quality for listings)

### Database Indexing Strategy
Add indexes to Prisma schema for high-query tables:
```
HdbTransaction: compound index on (town, flatType, month)
Viewing: index on (propertyId, scheduledAt)
ViewingSlot: index on (propertyId, date, status)
Offer: index on (propertyId, status)
Transaction: index on (sellerId, status)
Notification: index on (recipientType, recipientId, status)
AuditLog: compound index on (entityType, entityId), index on (action), index on (createdAt)
VerifiedViewer: unique index on (phone)
Referral: unique index on (referralCode)
Seller: index on (agentId, status), index on (leadSource)
```

### Session Management
- Concurrent sessions allowed (seller on phone + desktop simultaneously)
- Session store: PostgreSQL-backed sessions (via `connect-pg-simple`) for persistence across server restarts
- Session timeout: 30 minutes inactivity for 2FA users, 24 hours for non-2FA (sellers without 2FA)
- On password change: invalidate all other sessions for that user

### API Versioning
- All API routes prefixed with `/api/v1/`
- When breaking changes are needed in future, create `/api/v2/` routes while maintaining `/api/v1/` for backward compatibility
- API version header: `X-API-Version: v1`

### Notification Queue Resilience
- If WhatsApp API is down: queue failed notifications in `Notification` table with status `failed` and error details
- Retry failed WhatsApp notifications every 15 minutes (up to 3 retries)
- After 3 failed retries: fall back to email, log the fallback
- If both WhatsApp and email fail: in-app notification still delivered, agent alerted to communication failure
- On VPS restart: check for unsent scheduled notifications (viewing reminders, deadline alerts) and send them immediately if they were missed

### Storage Monitoring
- Track total upload storage usage per seller and overall
- Alert admin when total storage exceeds 80% of VPS disk (configurable threshold in SystemSetting)
- Per-seller storage limit: 200MB (20 photos × optimized + documents) — configurable in SystemSetting
- Admin can view storage usage in the analytics dashboard

### Maintenance Mode
- Admin can toggle maintenance mode from System Settings
- When enabled: public site shows a maintenance page ("We're making improvements. Back soon."), all API endpoints return 503, scheduled jobs are paused, existing sessions remain active but new logins are blocked
- When disabled: everything resumes, queued notifications are processed
- Maintenance mode toggle logged in audit trail

### Data Export (Admin Only)
- Admin can export data to CSV from the analytics dashboard:
  - Sellers list (name, phone, status, agent, dates — excludes NRIC)
  - Transactions list (property, price, dates, status)
  - Financial summary (transaction, commission, payment status)
  - Viewings report (property, viewer count, conversion)
  - Audit log (filtered export)
- CSV exports exclude sensitive personal data (full NRIC, CDD documents) — only aggregated/masked data
- Each export logged in audit trail: `data.exported` with details of what was exported and by whom

### Suspicious Transaction Reporting (STR)
Out of scope for this platform. STR is handled through Huttons' internal compliance system. If an agent identifies a suspicious transaction, they report it through Huttons' internal channels, not through sellmyhouse.sg.
