# SellMyHouse.sg — Phase 1: Foundation (MVP)
# Prerequisites: Read phase-0-shared-context.md first for schema, tech stack, and cross-cutting concerns.
# This phase builds: project setup, HDB data ingestion, public website, auth, notifications, PWA.

## Phase 1: Foundation (MVP)

### 1.1 Project Setup
- Initialize Node.js project with Express
- Configure PostgreSQL + Prisma
- Set up project structure:
  ```
  sellmyhouse/
  ├── prisma/
  │   ├── schema.prisma
  │   ├── seed.js              # Seed HDB transaction data from CSV
  │   └── migrations/
  ├── src/
  │   ├── server.js
  │   ├── config/
  │   │   ├── database.js
  │   │   ├── auth.js
  │   │   ├── constants.js     # Commission rates, GST rate, etc.
  │   │   └── whatsapp.js      # Meta WhatsApp Business API config
  │   ├── routes/
  │   │   ├── public.js        # Landing page, report tool, privacy policy, terms of service
  │   │   ├── viewing.js       # Public viewing booking page (no auth required)
  │   │   ├── auth.js          # Login, register, logout, 2FA setup
  │   │   ├── seller.js        # Seller dashboard routes
  │   │   ├── agent.js         # Agent dashboard routes
  │   │   ├── admin.js         # Admin dashboard routes (team, analytics, settings, audit)
  │   │   └── api/
  │   │       ├── reports.js   # HDB market report API
  │   │       ├── financial.js # Financial calculation API
  │   │       ├── listings.js  # Listing CRUD + AI generation
  │   │       ├── leads.js     # Lead capture API
  │   │       ├── notifications.js  # Notification API
  │   │       └── webhook.js   # WhatsApp webhook handler
  │   ├── middleware/
  │   │   ├── auth.js          # Authentication middleware
  │   │   ├── rbac.js          # Role-based access control
  │   │   ├── audit.js         # Audit logging middleware
  │   │   ├── consent.js       # PDPA consent validation
  │   │   └── rateLimit.js
  │   ├── services/
  │   │   ├── ai/
  │   │   │   ├── index.js         # AI service facade — exposes generateNarrative(), generateListing(), etc.
  │   │   │   ├── provider.js      # Provider interface — defines the contract all providers must implement
  │   │   │   ├── anthropic.js     # Anthropic Claude provider implementation
  │   │   │   ├── openai.js        # OpenAI GPT provider implementation (stub, same interface)
  │   │   │   ├── google.js        # Google Gemini provider implementation (stub, same interface)
  │   │   │   └── prompts/
  │   │   │       ├── financialNarrative.js   # Prompt template for financial report narrative
  │   │   │       ├── listingDescription.js   # Prompt template for property listing
  │   │   │       ├── weeklyUpdate.js         # Prompt template for seller weekly update
  │   │   │       ├── offerAnalysis.js        # Prompt template for offer comparison
  │   │   │       └── marketContent.js        # Prompt template for market insights
  │   │   ├── hdbData.js       # HDB transaction data queries
  │   │   ├── hdbSync.js       # data.gov.sg auto-ingestion
  │   │   ├── financial.js     # Financial calculation engine
  │   │   ├── listing.js       # Listing generation service
  │   │   ├── portalFormatter.js  # Format listings for PropertyGuru, 99.co, SRX
  │   │   ├── notification.js  # Unified notification service (WhatsApp + email + in-app)
  │   │   ├── whatsapp.js      # Meta WhatsApp Business API client
  │   │   ├── email.js         # Email sending (Nodemailer)
  │   │   ├── storage.js       # File storage abstraction
  │   │   └── settings.js     # System settings CRUD (reads from SystemSetting table)
  │   ├── jobs/
  │   │   ├── hdbDataSync.js   # Scheduled job: sync HDB data from data.gov.sg
  │   │   ├── reminders.js     # Scheduled job: daily timeline + viewing morning reminders
  │   │   ├── viewingAlerts.js # Scheduled job: every 15 min — 1hr-before reminders, post-viewing prompts
  │   │   └── retention.js     # Scheduled job: PDPA data retention checks
  │   ├── utils/
  │   │   ├── formatters.js    # Currency, date, address formatting
  │   │   ├── validators.js    # Input validation
  │   │   └── pdpa.js          # PDPA consent helpers
  │   └── views/               # EJS templates for public pages
  ├── client/                   # React dashboard app (Vite)
  │   ├── src/
  │   │   ├── seller/          # Seller dashboard components
  │   │   └── agent/           # Agent dashboard components
  ├── public/                   # Static assets served by nginx
  │   ├── manifest.json         # PWA manifest
  │   ├── sw.js                 # Service worker
  │   ├── icons/                # App icons (192x192, 512x512, maskable)
  │   └── offline.html          # Offline fallback page
  ├── tests/
  │   ├── unit/
  │   ├── integration/
  │   └── e2e/
  ├── data/
  │   └── hdb/                 # CSV files for initial seeding
  └── uploads/                 # All uploaded files
      ├── photos/              # {sellerId}/{propertyId}/
      ├── documents/           # CDD docs, encrypted
      ├── otp/                 # Scanned OTP copies
      └── invoices/            # Huttons commission invoices
  ```

### 1.2 HDB Data Ingestion & Sync
- **Initial seed:** Write a seed script that reads the HDB resale CSV files and bulk-inserts into `HdbTransaction` table
  - Files to ingest:
    - `Resale_Flat_Prices_Based_on_Approval_Date_1990__1999.csv`
    - `Resale_Flat_Prices_Based_on_Approval_Date_2000__Feb_2012.csv`
    - `Resale_Flat_Prices_Based_on_Registration_Date_From_Mar_2012_to_Dec_2014.csv`
    - `Resale_Flat_Prices_Based_on_Registration_Date_From_Jan_2015_to_Dec_2016.csv`
    - `Resale_flat_prices_based_on_registration_date_from_Jan2017_onwards.csv`
  - Handle schema differences between files (some have `remaining_lease`, some don't)
  - Mark all seeded records with `source: csv_seed`
  - Total: ~972,000 records
- **Auto-sync from data.gov.sg:**
  - Build a scheduled job (`jobs/hdbDataSync.js`) that runs weekly (Sunday midnight SGT)
  - Fetches the latest HDB resale flat prices dataset from data.gov.sg API (dataset ID: `d_8b84c4ee58e3cfc0ece0d773c8ca6abc`)
  - Compares against existing records, inserts only new transactions
  - Marks new records with `source: datagov_sync`
  - Logs each sync in `HdbDataSync` table (timestamp, records added, status)
  - On failure: log error, send notification to agent, continue with existing data

### 1.3 Public Website
- Landing page (based on the existing HTML prototype design — see sellmyhouse.html)
- HDB Market Report tool:
  - User selects town, flat type, storey range
  - API queries `HdbTransaction` table for recent (last 24 months) data matching the criteria
  - Returns: min, median, max prices, transaction count, price per sqm range
  - No personal data collected at this stage — no PDPA consent required
  - Include disclaimer: "This is an indicative range based on publicly available HDB resale data and does not constitute a formal valuation."
- Lead capture form with PDPA consent (see prototype for exact consent wording and structure)
  - Fields: name, mobile number
  - Hidden field: leadSource (auto-detected from UTM parameters or referrer: website/tiktok/instagram/referral/other; default: website)
  - PDPA consent checkboxes as specified in prototype
  - Spam protection: honeypot field, time-based form validation (reject if submitted in <3 seconds), rate limit 3 submissions per hour per IP
- Privacy Policy page (full text — see the privacy modal content in the prototype)
- Terms of Service page — covers: service description ($1,499 fixed fee for HDB selling service), non-exclusive engagement, payment terms (pay only on successful completion), cancellation/termination (seller can terminate at any time), limitation of liability (no formal valuations, no financial advice, estimates only), intellectual property, governing law (Singapore), dispute resolution. Link from footer.
- Cookie consent banner (essential cookies only, no tracking)

### 1.4 Authentication
- Seller auth: email + password registration/login
- Agent auth: email + password login (no public registration — agents are created by admin)
- Session-based auth with secure cookies
- RBAC middleware with three roles:
  - **Seller:** can only access their own data (property, financials, documents, notifications)
  - **Agent:** can access their assigned sellers' data, review queue for their sellers, their own pipeline
  - **Admin:** can access everything — all agents' pipelines, all sellers, full audit trail, system settings, team management, analytics. Admin inherits all agent capabilities.

**Two-Factor Authentication (2FA) — optional for sellers, mandatory for agents/admin:**

All users can enable 2FA. For agents and admin accounts, 2FA is mandatory (enforced on first login — they must set it up before accessing the dashboard).

**Method: TOTP (Time-based One-Time Password)**
- Use `otplib` or `speakeasy` npm package for TOTP generation/verification
- Compatible with Google Authenticator, Authy, Microsoft Authenticator, and any TOTP app
- Flow:
  1. User goes to Settings → Security → Enable 2FA
  2. System generates a TOTP secret and displays a QR code
  3. User scans QR code with their authenticator app
  4. User enters the 6-digit code from the app to confirm setup
  5. System stores the encrypted TOTP secret in the user's record
  6. System generates 8 backup recovery codes (one-time use, for when the user loses their phone) — display once, user must save them
  7. On subsequent logins: after entering email + password, user is prompted for the 6-digit TOTP code
  8. If user loses their authenticator: they can use a backup recovery code to log in, then set up 2FA again

**Schema additions:**
- Add to `Agent` model: `twoFactorSecret` (string, nullable, encrypted at rest), `twoFactorEnabled` (bool, default false), `twoFactorBackupCodes` (JSON, nullable, encrypted — array of hashed backup codes)
- Add to `Seller` model: same three fields
- Add to `AuditLog` actions: `auth.2fa_enabled`, `auth.2fa_disabled`, `auth.2fa_backup_used`

**Security rules:**
- TOTP secret is encrypted at rest in the database (use the same AES-256 encryption key as CDD documents)
- Backup codes are hashed (bcrypt) — they cannot be viewed again after initial display
- Each backup code can only be used once — mark as used after successful login
- Agent/admin accounts: 2FA is mandatory. On first login, if `twoFactorEnabled` is false, redirect to 2FA setup page. Cannot access any other page until 2FA is configured.
- Seller accounts: 2FA is optional. Prompt to enable during onboarding (Step 5 or dashboard settings) but do not require it.
- If 2FA is enabled, session timeout should be shorter (30 minutes of inactivity vs 24 hours without 2FA)
- Failed 2FA attempts: lock account after 5 consecutive failures, require password reset to unlock

### 1.5 Notification Service
Build a unified notification service supporting WhatsApp (Meta Business API, primary), email (Nodemailer, secondary/fallback), and in-app notifications.

**WhatsApp:**
- Webhook endpoint at `/api/webhook/whatsapp` for delivery receipts
- Message templates to register with Meta: `lead_confirmation`, `financial_report_ready`, `timeline_reminder`, `otp_status_update`, `invoice_sent`, `general_update`, `viewing_otp`, `viewing_confirmed_buyer`, `viewing_confirmed_seller`, `viewing_reminder_buyer`, `viewing_reminder_seller`, `viewing_cancelled`
- **Template approval:** Meta requires pre-approval of all message templates before they can be used. Submit templates via Meta Business Manager. Approval typically takes 24-48 hours. If a template is rejected: revise wording per Meta's guidelines (no promotional language in transactional templates, no URL shorteners, include business name) and resubmit. Until templates are approved, use email as the primary channel.
- **Fallback for unapproved templates:** If a WhatsApp template is not yet approved or gets suspended, the notification service should automatically fall back to email for that template type and log the fallback reason.
- Store `whatsappMessageId` for delivery tracking
- PDPA: only send to numbers with active service consent; marketing messages only with marketing consent

**Email:**
- HTML templates matching sellmyhouse.sg branding
- Unsubscribe link in all marketing emails
- Send reports and invoices as attachments

**In-App:**
- Store in `Notification` table, display as notification feed in dashboards

**Fallback:** If WhatsApp fails, automatically retry via email.

### 1.6 Progressive Web App (PWA)
The entire platform is a PWA — installable on mobile home screens, works in any desktop browser, and provides an app-like experience on phones without requiring app store distribution.

**manifest.json (`public/manifest.json`):**
```json
{
  "name": "SellMyHouse.sg",
  "short_name": "SellMyHouse",
  "description": "Sell your HDB for $1,499 — AI-powered, full agent guidance",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#fafaf7",
  "theme_color": "#1a1a2e",
  "orientation": "any",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

**Service worker (`public/sw.js`):**
- Cache strategy: **Network First with Cache Fallback** for all pages and API calls
  - Try network first (so content is always fresh)
  - If offline, serve cached version
  - Cache the landing page, dashboard shell, CSS, JS, and fonts on install
- Pre-cache: landing page, offline fallback page, critical CSS/JS bundles, app icons
- Do NOT cache: API responses with personal data (financial reports, seller details) — these should always be fresh from the server
- Offline fallback: when completely offline and no cache available, show `offline.html` with message: "You're offline. Please check your connection. Your data is safe — we'll sync when you're back online."
- Cache versioning: update cache name on each deployment so stale caches are cleared

**Registration (in main HTML template):**
```html
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#1a1a2e">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="apple-touch-icon" href="/icons/icon-192.png">

<script>
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js');
  }
</script>
```

**Responsive design requirements:**
All pages must work on these viewports:
- Mobile: 375px width (iPhone SE / small Android)
- Tablet: 768px width (iPad)
- Desktop: 1200px+ width
- Use Tailwind's responsive prefixes (`sm:`, `md:`, `lg:`) consistently
- Touch targets: minimum 44x44px for all interactive elements on mobile
- Photo upload: use native file picker which triggers camera option on mobile
- Agent dashboard: prioritise the review queue and pipeline on mobile (full analytics view is desktop-focused)
- Seller dashboard: optimise for mobile-first since sellers will primarily use their phones

**App icons:**
- Generate icons at 192x192 and 512x512 pixels
- Create a maskable variant (512x512 with safe zone padding) for Android adaptive icons
- Apple touch icon at 192x192
- Use the sellmyhouse.sg brand colours (ink: #1a1a2e, accent: #c8553d)

### Tests for Phase 1:
```
Unit Tests:
- hdbData.service: getTransactionsByTownAndType returns correct aggregates
- hdbData.service: handles missing flat types gracefully
- hdbData.service: storey adjustment factors apply correctly
- hdbSync.service: correctly identifies new records vs existing
- hdbSync.service: handles data.gov.sg API errors gracefully
- validators: rejects invalid Singapore phone numbers (8 digits, starts with 8 or 9)
- validators: rejects empty name
- pdpa.helpers: generates correct consent record structure
- formatters: currency formatting (SGD with commas)
- formatters: remaining lease string parsing ("61 years 05 months" → {years: 61, months: 5})
- notification.service: selects correct channel based on notification type
- notification.service: blocks marketing messages without consent
- whatsapp.service: formats message template correctly
- whatsapp.service: handles API error responses

Integration Tests:
- POST /api/leads — creates seller + consent record + audit log + sends notification
- POST /api/leads — rejects if required consent not given
- POST /api/leads — rejects duplicate phone number (existing active lead)
- GET /api/reports/hdb — returns correct price range for known town/type
- GET /api/reports/hdb — returns 404 for invalid town
- GET /api/reports/hdb — does not expose any personal data
- POST /api/webhook/whatsapp — correctly processes delivery receipts
- Auth: seller cannot access agent routes
- Auth: unauthenticated user cannot access dashboards
- 2FA: agent without 2FA enabled is redirected to 2FA setup on login
- 2FA: agent with 2FA enabled must provide TOTP code after password
- 2FA: valid TOTP code grants access
- 2FA: invalid TOTP code is rejected, access denied
- 2FA: backup recovery code works for one-time login
- 2FA: used backup code cannot be reused
- 2FA: 5 failed 2FA attempts locks account
- 2FA: seller can log in without 2FA if not enabled (optional for sellers)

E2E Tests:
- Landing page loads, report tool works end-to-end
- Lead form submission with consent checkboxes
- Lead form blocks submission without required consents
- Privacy policy modal opens and displays content
- Cookie banner appears and can be accepted/declined
- PWA: manifest.json is served correctly and contains required fields
- PWA: service worker registers successfully
- PWA: site passes Lighthouse PWA audit (installability criteria)
- PWA: offline fallback page displays when network is unavailable
- Responsive: landing page renders correctly on 375px mobile viewport
- Responsive: seller dashboard renders correctly on 375px mobile viewport
- Responsive: all touch targets are minimum 44x44px on mobile
```

