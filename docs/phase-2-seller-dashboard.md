# SellMyHomeNow.sg — Phase 2: Seller Dashboard & Financial Engine
# Prerequisites: Phase 1 must be complete. Read phase-0-shared-context.md for schema reference.
# This phase builds: seller onboarding wizard, seller dashboard, financial calculation engine,
# AI integration (provider-agnostic), viewing scheduler, co-broking policy,
# fallen-through/relisting flow, price changes, complex case workflows, notification preferences.

## Phase 2: Seller Dashboard & Financial Engine

### 2.1 Seller Onboarding Wizard
When a lead converts to an engaged seller (after initial consultation call and CDD), the seller logs in and sees a step-by-step onboarding wizard before reaching the full dashboard. Each step must be completed before advancing.

**Step 1: "Welcome to SellMyHomeNow.sg"**
- Brief intro: what to expect, how the process works, your role vs agent's role
- Link to "Complete HDB Resale Timeline" video tutorial
- Accept: "I understand the process"

**Step 2: "Your Property Details"**
- Form to enter/confirm: town, block, street, flat type, storey range, floor area, lease commencement date
- Pre-populated from HDB report tool if they used it as a lead

**Step 3: "Your Financial Situation"**
- Form: outstanding loan balance, CPF OA used for this flat, year of purchase, subsidised flat (yes/no), first-timer or second-timer
- "Not sure?" helper links next to each field explaining how to find these numbers (CPF website, HDB website)
- Option to skip individual fields and enter them later (report will note "estimated" for missing inputs)

**Step 4: "Take Photos of Your Home"**
- Embedded photo tutorial video
- Checklist of recommended shots: living room, kitchen, master bedroom, other bedrooms, bathrooms, balcony/view, corridor/entrance
- Upload interface (can be done now or later from dashboard)

**Step 5: "Understand Your Agreement"**
- Embedded CEA forms video tutorial
- Summary of key terms: non-exclusive, $1,499 + GST, co-broking allowed (commission not shared), cancellation terms
- "I have watched the video and understand the terms" checkbox
- Note: actual signing happens via video call with agent (tracked in `EstateAgencyAgreement`)

**After onboarding:** seller lands on the full dashboard with their progress visible.

### 2.2 Seller Dashboard
- **Overview page:** Transaction status, next steps (dynamically generated based on current stage), key dates, unread notifications, onboarding progress if incomplete
- **Property details:** Edit flat details
- **Photo upload:** Drag-and-drop, max 20 photos, 5MB each, JPG/PNG. Status: uploaded → pending_review → approved/rejected. Link to photo tutorial video.
- **Viewing scheduler:**

  **Seller's view (dashboard):**
  - Seller creates available time slots for their property:
    - Select date, start time → end time auto-calculates based on `viewing_slot_duration` SystemSetting (default: 15 minutes)
    - Choose slot type: **Single** (1 party only) or **Group** (open house style, multiple parties can book the same slot, seller sets max viewers, default 5)
    - Bulk slot creation: "Add weekly recurring slots" (e.g., every Saturday 10am-12pm, auto-creates 15-min slots for the next 4 weeks)
  - Seller sees a calendar view of all their slots: available (green), booked (blue), full (grey), cancelled (red)
  - Seller receives notification (WhatsApp + in-app) when a slot is booked, with viewer details
  - Seller can cancel a slot (notify all booked viewers via WhatsApp + email)
  - After viewing is conducted: seller logs feedback in the dashboard (text notes — "seemed interested", "concerned about lease", "brought family, positive", etc.)
  - Seller can see: total viewings conducted, upcoming viewings, feedback history

  **Public booking page (buyer-facing):**
  - Each listed property gets a unique public booking URL: `sellmyhomenow.sg/view/{propertySlug}`
  - This URL is included in the portal-ready listing output so the agent can add it to PropertyGuru/99.co listings
  - Page shows: property summary (town, flat type, floor area, storey, asking price — no seller personal details), list of available slots (date, time, single/group indicator)
  - To book, the buyer fills in:
    - Full name (required)
    - Mobile number (required)
    - "Are you..." radio button: **"Buying for myself"** / **"I am a property agent representing a buyer"**
    - If agent: additional fields — agent name (auto-filled from above), CEA registration number, agency name
    - PDPA consent checkbox (required): "I consent to SellMyHomeNow.sg collecting my name and contact number to coordinate this property viewing."

  **Booking flow (verify phone once, book freely after):**

  When the buyer submits the form, the system checks if their phone number exists in the `VerifiedViewer` table.

  **If phone number is NOT verified (first-time viewer):**
  - Step 1: Send a 6-digit OTP to the buyer's mobile via WhatsApp (or SMS fallback)
    - Show OTP input screen: "We've sent a verification code to your WhatsApp. Enter it below to confirm your booking."
    - OTP expires after 5 minutes
    - Max 3 OTP requests per phone number per hour
  - Step 2: Buyer enters 6-digit code → system verifies
    - On valid OTP:
      - Create `VerifiedViewer` record (name, phone, viewerType, consent, phoneVerifiedAt)
      - Create `Viewing` record linked to the `VerifiedViewer`
      - Confirm the booking (see confirmation flow below)
    - On invalid OTP: "Invalid code. Please try again." Max 3 attempts, then block and require new OTP.
    - On expired OTP: "Code expired. Request a new one."

  **If phone number IS already verified (returning viewer):**
  - Skip OTP entirely
  - Auto-fill name from `VerifiedViewer` record (buyer can update if needed)
  - Create `Viewing` record linked to existing `VerifiedViewer`
  - Confirm the booking immediately
  - Buyer experience: fill in phone → recognised → pick slot → confirmed in 15 seconds

  **On booking confirmation (both paths):**
  - Update `VerifiedViewer.totalBookings` count and `lastBookingAt`
  - Update `ViewingSlot.currentBookings` count
  - If single slot and first booking → mark slot as `booked`
  - If group slot and `currentBookings >= maxViewers` → mark slot as `full`
  - Send booking confirmation to viewer via WhatsApp: "Your viewing at [address] is confirmed for [date] [time]. To cancel: [cancellation link]"
  - Send notification to seller (WhatsApp + in-app): "New viewing booked: [date/time], [name], [buyer/agent]"
  - Send notification to agent (in-app): new viewing logged
  - Create audit log entry: `viewing.scheduled`

  **Cancellation:**
  - Booking confirmation includes a unique cancellation link: `sellmyhomenow.sg/view/cancel/{viewingId}/{cancelToken}`
  - One-click cancellation, no login required
  - On cancel: update `Viewing.status` to `cancelled`, decrement `ViewingSlot.currentBookings`, notify seller (WhatsApp + in-app), create audit log

  **Viewing notification lifecycle (all via WhatsApp + in-app):**

  | When | Who | Message |
  |------|-----|---------|
  | On booking confirmed | Buyer/agent | "Your viewing at [address] is confirmed for [date] [time]. To cancel: [link]" |
  | On booking confirmed | Seller | "New viewing booked: [date] [time] — [name] ([buyer/agent]). You have [total] viewings scheduled this week." |
  | On booking confirmed | Agent | In-app only: new viewing logged with viewer details |
  | On cancellation | Seller | "[Name] has cancelled their viewing on [date] [time]. Your slot is now available again." |
  | On cancellation | Agent | In-app only: viewing cancelled |
  | Morning of viewing day (9am SGT) | Seller | "Reminder: You have [count] viewing(s) today. First at [time] with [name]. Make sure your home is ready!" |
  | Morning of viewing day (9am SGT) | Buyer/agent | "Reminder: Your viewing at [address] is today at [time]. The seller is expecting you. To cancel: [link]" |
  | 1 hour before viewing | Buyer/agent | "Your viewing at [address] is in 1 hour ([time]). Address: Blk [block] [street]. To cancel: [link]" |
  | After viewing time passes | Seller | In-app prompt: "How did the viewing with [name] go?" (link to feedback form) |

  **Implementation notes:**
  - Morning reminders: handled by the daily `reminders` scheduled job (9am SGT). Query all viewings scheduled for today, send batch notifications.
  - 1-hour-before reminders: either handled by a more frequent job (runs every 15 minutes, checks for viewings in the next 60-75 minutes) or by scheduling the notification at booking time using a delayed job.
  - Post-viewing feedback prompt: triggered when current time passes the viewing slot's end time. Can be part of the 15-minute job or a separate check.
  - If seller has multiple viewings on the same day, the morning reminder consolidates them: "You have 4 viewings today: 10:00 (John), 10:15 (Mary), 14:00 (Agent Tan), 14:15 (Lisa)."
  - No-show tracking: if seller marks a viewing as `no_show`, the viewer is flagged in `VerifiedViewer` for agent awareness (not blocked from future bookings, but agent can see the history).

  **Agent intelligence from VerifiedViewer data:**
  - Agent dashboard shows active viewers across all listings: which verified viewers are looking at multiple properties (high-intent buyers), which are agents bringing multiple clients
  - Viewer activity: "John (91234567) has booked viewings for 3 of your listings this week" — this is a hot lead

  **Multi-layer spam protection:**
  1. **Honeypot field:** Hidden form field (e.g., `<input name="website" style="display:none">`) — real users leave it blank, bots fill it in. If filled → silently reject, return fake success (don't reveal the trap).
  2. **Phone OTP verification (first time only):** Eliminates all bots — a bot cannot receive and enter a WhatsApp OTP. Subsequent bookings from verified numbers skip OTP.
  3. **Rate limiting per phone number:** Max 3 bookings per phone number per day. Max 3 OTP requests per phone number per hour.
  4. **Rate limiting per IP:** Max 10 booking attempts per IP per hour.
  5. **Time-based form validation:** Record when the page loaded. If form is submitted in under 3 seconds, likely a bot → reject silently.
  6. **Duplicate detection:** Same phone number cannot book the same slot twice.

  - NO Google reCAPTCHA — avoids third-party tracking, aligns with PDPA-conscious positioning.
  - The booking page does NOT require login — it's public. But viewer contact details are only visible to the seller and agent (not other viewers).

  **Agent's view (agent dashboard → seller detail):**
  - See all viewings: upcoming, completed, cancelled, no-shows
  - See viewer details and type (buyer vs agent) — useful for tracking co-broke interest
  - See which verified viewers are viewing multiple listings (cross-listing intelligence)
  - See seller's feedback for each viewing
  - Viewing analytics: total viewings this week/month, conversion rate (viewings to offers)

  **Agent/Admin calendar view (agent dashboard → Viewings Calendar):**
  - Calendar view (month/week/day toggle) showing all viewings across all of the agent's active listings
  - Admin sees all viewings across ALL agents and ALL listings in a single calendar
  - Each viewing block shows: time, property address, viewer name, viewer type (buyer/agent), slot type (single/group)
  - Colour coding:
    - Green: confirmed/scheduled
    - Blue: completed (feedback logged)
    - Grey: completed (no feedback yet)
    - Red: cancelled
    - Orange: no-show
  - Click on a viewing block → expands to show: full viewer details, viewer's booking history across listings, seller's feedback, link to the property/seller detail page
  - Filter by: property/listing, viewer type (buyer/agent), status, date range
  - Admin-only: filter by agent (see one agent's viewings or all agents combined)
  - Daily summary: at the top of the day view, show total viewings count and properties being shown that day
  - Use a lightweight calendar library (e.g., FullCalendar for React, or a simple custom grid — avoid heavy dependencies)

  **SystemSetting for viewing configuration:**
  - `viewing_slot_duration`: default 15 (minutes), configurable by admin
  - `viewing_max_group_size`: default 5, configurable by admin
- **Document checklist:** Dynamic based on transaction stage. Items: NRIC, marriage cert, eligibility letter, OTP scan, estate agency agreement, etc.
- **Video tutorials:** Embedded YouTube, grouped by category
- **Timeline tracker:** Visual timeline, key dates, automated reminders (WhatsApp + email + in-app)
- **Notification feed:** All messages and updates with read/unread status
- **My Data page (PDPA):** View personal data, request corrections, withdraw consent

### 2.3 Financial Calculation Engine
**Inputs:** Flat details, outstanding loan, CPF OA used + accrued interest, subsidised flat status, first/second-timer status.

**Input handling for edge cases:**
- **Seller doesn't know CPF usage:** Accept "I don't know" → system estimates based on flat type, purchase year, and typical loan-to-value ratios. Report clearly marks these as rough estimates and directs seller to check CPF website (my.cpf.gov.sg) for actual figures.
- **Joint owners with different CPF contributions:** Accept CPF inputs for Owner 1 and Owner 2 separately. Calculate accrued interest for each. Show breakdown per owner in the report.
- **No outstanding loan (fully paid):** Accept $0 → calculation proceeds normally, loan deduction is simply zero.
- **Seller purchased before CPF was used (very old flats):** Accept $0 CPF usage.
- All optional/unknown fields default to $0 with a clear note in the report: "This field was not provided. Actual figures may differ."

**Calculation:**
```
Net Cash Proceeds = Sale Price - Outstanding Loan - CPF Refund (OA + accrued interest at 2.5% p.a.) - Resale Levy (if applicable) - Commission ($1,633.91) - Legal Fees (~$2,000-$3,000)

For joint owners:
  CPF Refund Owner 1 = Owner 1 OA used + Owner 1 accrued interest
  CPF Refund Owner 2 = Owner 2 OA used + Owner 2 accrued interest
  Total CPF Refund = Owner 1 + Owner 2
```

**Rules:**
- Resale levy rates from www.hdb.gov.sg
- CPF accrued interest at 2.5% p.a. from www.cpf.gov.sg
- MVP: accept lump sum "total CPF used" + "year of purchase" for approximate calculation
- All outputs include disclaimers directing to HDB and CPF Board
- If net proceeds calculate to negative: show a warning (not an error) — "Based on the figures provided, the sale proceeds may not cover all deductions. Please verify your inputs and consult HDB/CPF for exact figures."

**Flow:** AI generates report + narrative → agent reviews → approves → sends to seller via chosen channel(s)

### 2.4 Co-Broking Policy
The platform welcomes co-broking (as required by CEA PGC guidelines) but does not share commission.

**Policy:** "Co-broking welcomed. We co-broke the property but not the commission. The seller's agent fee is a fixed $1,499 + GST. The buyer's agent is paid by their own client."

**Implementation:**
- When recording an offer from a buyer with their own agent (`Offer.buyerAgentName` is filled), the system marks `Offer.isCoBroke = true`
- Co-broking terms are stated in the `EstateAgencyAgreement.coBrokingTerms` field
- Co-broking terms are visible in the portal-ready listing output so buyer agents know upfront
- No commission splitting logic needed in the platform — commission is always $1,633.91 from the seller, period

### 2.3 AI Integration (Provider-Agnostic)

**Architecture: The AI layer must NOT be hardwired to any specific AI model or provider.** The application code calls a generic AI service interface. The actual provider (Anthropic, OpenAI, Google, etc.) is selected via configuration and can be swapped without changing any application code.

**Provider interface (`services/ai/provider.js`):**
```javascript
// Every AI provider must implement this interface:
class AIProvider {
  constructor(config) {}

  // Generate a text completion from a prompt
  async complete({ systemPrompt, userPrompt, maxTokens, temperature }) {
    // Returns: { text: string, provider: string, model: string, tokensUsed: number }
    throw new Error('Not implemented');
  }
}
```

**Provider implementations:**
- `anthropic.js` — Full implementation using Anthropic SDK. Default provider.
  - Uses `@anthropic-ai/sdk` npm package
  - Model configurable via SystemSetting (default: `claude-sonnet-4-20250514`)
- `openai.js` — Stub implementation using OpenAI SDK, same interface.
  - Uses `openai` npm package
  - Ready to activate by changing config
- `google.js` — Stub implementation using Google Generative AI SDK, same interface.
  - Uses `@google/generative-ai` npm package
  - Ready to activate by changing config

**AI service facade (`services/ai/index.js`):**
```javascript
// Application code calls these methods — never calls a provider directly
const aiService = {
  generateFinancialNarrative(reportData) {},
  generateListingDescription(propertyDetails, photoDescriptions) {},
  generateWeeklyUpdate(sellerName, pipelineStatus, viewingCount, marketData) {},
  generateOfferAnalysis(offerAmount, marketMedian, recentTransactions) {},
  generateMarketContent(dataInsights) {},
};

// Internally, each method:
// 1. Loads the prompt template from services/ai/prompts/
// 2. Gets the active provider from SystemSetting ('ai_provider': 'anthropic'|'openai'|'google')
// 3. Gets the active model from SystemSetting ('ai_model': 'claude-sonnet-4-20250514'|'gpt-4o'|etc)
// 4. Instantiates the correct provider
// 5. Calls provider.complete() with the prompt
// 6. Returns the result with provider/model metadata attached
```

**Prompt templates (`services/ai/prompts/`):**
- Prompt templates are provider-agnostic plain text/template strings
- Each template defines `systemPrompt` and `userPrompt` as functions that accept data and return strings
- Templates include Singapore HDB market context, disclaimer instructions, and CEA detail injection
- Templates do NOT include provider-specific formatting (no Anthropic XML tags, no OpenAI function calling syntax)

**SystemSetting keys for AI configuration:**
- `ai_provider`: "anthropic" | "openai" | "google" (default: "anthropic")
- `ai_model`: model identifier string (default: "claude-sonnet-4-20250514")
- `ai_max_tokens`: default max tokens (default: 2000)
- `ai_temperature`: default temperature (default: 0.3 — low for factual outputs)

**Admin can switch providers from the System Settings panel** without redeploying. Changing `ai_provider` and `ai_model` takes effect on the next AI generation request.

**All AI outputs record which provider and model generated them** — stored in the entity record (e.g., `FinancialReport.aiProvider`, `FinancialReport.aiModel`) and in the audit log. This is important for traceability: if you switch models and quality changes, you can trace which model produced which output.

**Environment variables for API keys:**
```
AI_ANTHROPIC_API_KEY=sk-ant-...
AI_OPENAI_API_KEY=sk-...          # optional, only needed if switching to OpenAI
AI_GOOGLE_API_KEY=...             # optional, only needed if switching to Google
```
Only the active provider's key needs to be set. The system should not error on startup if inactive provider keys are missing.

**Testing AI integration:**
- Mock the provider interface in tests — never call real AI APIs in automated tests
- Create mock provider (`tests/mocks/mockAIProvider.js`) that returns fixture responses
- Test that the facade correctly routes to the configured provider
- Test that prompt templates produce valid prompt strings from input data
- Test that provider switching via SystemSetting works without restart
- Test that AI outputs record the correct provider/model metadata

### Tests for Phase 2:
```
Unit Tests:
- financial.service: calculates net proceeds correctly for standard case
- financial.service: applies resale levy correctly for 2nd-timer subsidised
- financial.service: calculates CPF accrued interest correctly (known input/output pairs)
- financial.service: handles zero CPF usage / zero loan cases
- financial.service: commission is always $1,633.91
- financial.service: net proceeds = sale price - loan - cpf refund - levy - commission - legal
- financial.service: returns error if required inputs missing
- ai.service: handles AI provider timeout/error gracefully
- ai.service: routes to correct provider based on SystemSetting
- ai.service: records provider and model metadata in output
- ai.service: prompt templates produce valid prompts from input data

Integration Tests:
- POST /api/financial/calculate — returns correct report structure
- PUT /api/financial/report/:id/approve — only agent can approve, creates audit log
- PUT /api/financial/report/:id/send — sends notification via chosen channel(s)
- Photo upload stores files correctly, creates pending review status
- My Data page shows all seller's personal data

Regression Tests:
- 20+ financial calculation edge cases (zero CPF, zero loan, max levy, old lease, million-dollar flat, negative net proceeds warning, joint owners)
- GST: $1,499 * 0.09 = $134.91, total = $1,633.91
- CPF accrued interest: known 10-year and 20-year cases match expected values
```


---

## Phase 2 Additions (from Addendum)

## Phase 2 Additions

### 2.5 Fallen Through & Relisting
When a transaction falls through (buyer doesn't exercise OTP, financing fails, etc.):

**Flow:**
1. Agent updates Transaction status to `fallen_through`, enters reason
2. System automatically:
   - Reverts `Listing` status to `draft`
   - Reverts `Property` status to `draft`
   - Clears the transaction link (property is no longer under transaction)
   - Preserves all viewing history and previous offer data (useful context for relisting)
   - Notifies seller (WhatsApp + in-app): "Unfortunately, the sale did not proceed. [Reason]. Your listing has been reverted to draft. When you're ready, your agent will re-review and relist your property."
3. Seller can update photos, price, or details
4. Agent re-reviews and re-approves → listing goes live again
5. Previous portal listings are marked `expired` → agent creates new portal postings
6. All viewing slots are cleared — seller creates new availability
7. Audit log: `transaction.fallen_through` with reason

**No additional charge.** The $1,499 fee is only collected on successful completion. Relisting after a fallen-through transaction is part of the service.

### 2.6 Price Changes on Live Listings
- Seller can update asking price at any time from their dashboard
- When price changes on a live listing:
  1. New price is recorded in `Property.priceHistory` JSON array
  2. `Listing` status auto-reverts to `pending_review`
  3. Agent is notified: "Seller has changed asking price from $X to $Y. Listing requires re-review."
  4. Agent reviews → approves → listing goes live with new price
  5. Portal-ready content is regenerated with the new price
  6. Agent updates the portals manually (price change in PropertyGuru/99.co)
  7. Audit log: `property.price_changed` with old and new price

### 2.7 Complex Case Workflows
The platform provides guided instructions for sellers in complex situations. When an agent identifies a complex case during initial consultation or onboarding, they flag it in the system.

**Agent flags a complex case:**
- In the seller detail view, agent clicks "Flag Complex Case" → selects type → adds notes
- System creates `CaseFlag` record
- Seller sees a banner on their dashboard: "Your agent has noted a special circumstance with your sale. Please review the guidance below."

**Guided instructions by case type:**

**Deceased Estate:**
- Display: "Selling a property from a deceased estate requires additional steps."
- Checklist:
  - ☐ Obtain Grant of Probate or Letters of Administration from the Court
  - ☐ All legal beneficiaries must agree to the sale
  - ☐ Appoint an executor/administrator to sign on behalf of the estate
  - ☐ Provide death certificate and probate documents to your agent
  - ☐ HDB will require all relevant court orders before processing
- Note: "This process typically takes 3-6 months longer than a standard sale. Consult a lawyer for specific legal advice."
- Agent notes field: agent records case-specific details

**Divorcing Couple:**
- Display: "Selling a matrimonial property during divorce proceedings involves specific requirements."
- Checklist:
  - ☐ Determine if there is a court order for the sale of the flat
  - ☐ Both parties must agree to the sale terms (unless court-ordered)
  - ☐ If there is a court order, provide a copy to your agent
  - ☐ Both owners must sign the OTP (or their authorised representatives)
  - ☐ CPF refunds will go to each owner's individual CPF account
  - ☐ Sale proceeds division should follow the court order or mutual agreement
- Note: "We strongly recommend engaging a lawyer to handle the legal aspects of the sale. Your agent handles the property transaction."

**MOP Not Met (Minimum Occupation Period):**
- Display: "You cannot sell your HDB flat until the Minimum Occupation Period (MOP) is fulfilled."
- Information:
  - Standard MOP: 5 years from date of key collection
  - Your MOP completion date: [calculated from lease commencement + 5 years, or entered by agent]
  - "You can start preparing (photos, financial planning) before MOP, but you cannot list or market the property until [MOP date]."
- System enforces: listing cannot be created (status blocked) until MOP date has passed. Agent can override with documented reason (e.g., hardship appeal approved by HDB).

**Ethnic Integration Policy (EIP) / SPR Quota Restrictions:**
- Display: "Your flat may have buyer restrictions under HDB's Ethnic Integration Policy or Singapore PR quota."
- Information:
  - "Based on your block's racial composition, your flat can only be sold to buyers of [eligible ethnicities/residency status]."
  - "This may affect the pool of eligible buyers and the time needed to sell."
  - "Check the current EIP/SPR quota for your block on the HDB website."
  - Link: "Check your block's eligibility → hdb.gov.sg/eship"
- Agent notes: agent records the specific restrictions for this block
- Portal-ready listing output includes a note: "Subject to EIP/SPR eligibility" (avoids wasting time with ineligible buyers)

**PR (Permanent Resident) Seller:**
- Display: "As a Permanent Resident, additional conditions may apply to your sale."
- Checklist:
  - ☐ Confirm your PR status is still valid
  - ☐ If you have become a Singapore Citizen since purchase, rules may differ
  - ☐ PR owners may face resale levy if purchasing another subsidised flat
- Agent notes field for case-specific details

**Bank Loan (not HDB Loan):**
- Display: "Your property has a bank loan instead of an HDB loan."
- Information:
  - "Redemption process differs from HDB loans. Contact your bank for the redemption procedure and any early redemption penalties."
  - "Your bank will provide a redemption statement showing the exact outstanding amount."
  - "The bank's lawyer will handle the loan redemption at completion."
- Financial calculator: flag that outstanding loan figure should be sourced from bank redemption statement, not HDB

**Court Order Sale:**
- Display: "This sale is being conducted under a court order."
- Checklist:
  - ☐ Provide a copy of the court order to your agent
  - ☐ Sale must comply with all terms in the court order
  - ☐ Proceeds distribution must follow the court order
  - ☐ Engage a lawyer to ensure compliance
- Agent notes: record court order reference and key terms

### 2.8 Notification Preferences
- Seller can set their preferred notification channel in dashboard Settings:
  - **WhatsApp + Email** (default): receive notifications on both channels
  - **Email only**: opt out of WhatsApp notifications, receive email only
- Changing preference is logged in audit trail
- The notification service checks `seller.notificationPreference` before sending:
  - If `whatsapp_and_email`: send on both (WhatsApp primary, email secondary)
  - If `email_only`: send on email only, skip WhatsApp
  - In-app notifications are always sent regardless of preference
- Seller can switch preference anytime from their dashboard

---
