# Security Audit — HDB Seller Website

> **Usage**: Save to `.claude/commands/security-audit.md` and run with `/security-audit`, or run `claude "Read docs/security-audit.md and follow the instructions"`
>
> **Stack**: Node.js + TypeScript, Express, Prisma ORM, PostgreSQL, Nunjucks, HTMX + Tailwind CSS, bcrypt + TOTP (otplib), Docker on OVH VPS
>
> **Context**: This is a fixed-fee HDB property selling website. It collects NRIC/FIN, contact details, HDB property addresses, and financial information from sellers. PDPA compliance is a legal requirement.

You are performing a security audit on this codebase. For every check below, search the actual code, report what you find (file path + line number), and classify each finding as CRITICAL / HIGH / MEDIUM / LOW.

If a check passes, say PASS and move on. Do not explain what the check is — just report findings.

---

## 1. NRIC / FIN Protection (CRITICAL PRIORITY)

- [ ] Search the entire codebase for any field, column, variable, or constant storing NRIC/FIN data. List every location found.
- [ ] For each NRIC storage location: verify the value is encrypted at rest (AES-256 or equivalent). Flag any plain text varchar/string storage as CRITICAL.
- [ ] Search all Nunjucks templates (`.njk`, `.html`) for NRIC rendering. Every display must be masked as `****1234A`. Flag any unmasked output.
- [ ] Search all API responses (`res.json`, `res.send`, `res.render` context objects) for NRIC fields. Verify they are excluded or masked.
- [ ] Check that NRIC is never used as: a database primary key, a URL parameter (`req.params`, `req.query`), a session value, or a filename.
- [ ] Search all logging statements (`console.log`, `console.error`, any logging library) for NRIC data. Flag any found.
- [ ] Search email templates and PDF generation code for unmasked NRIC output.
- [ ] Verify NRIC collection only occurs at the legally required step (e.g., HDB resale document preparation) — not at registration or sign-up.
- [ ] Check for an automated mechanism (cron job, scheduled task) to delete or redact NRIC within 30 days of transaction completion.

## 2. Consent System

- [ ] Find the consent recording mechanism. Verify it stores: seller_id, purpose, consent version, timestamp, IP address, user agent.
- [ ] Check that consent is granular — separate records for: HDB listing creation, buyer data sharing, transaction data sharing, marketing.
- [ ] Trace the seller sign-up or listing creation flow: verify no personal data is written to the database before consent is recorded.
- [ ] Search all Nunjucks templates for consent checkboxes. Flag any that are pre-checked (`checked`, `checked="checked"`).
- [ ] Verify a consent withdrawal route exists (`DELETE /consent` or similar) and that it triggers actual data processing cessation — not just a flag update.
- [ ] Verify marketing consent is a separate checkbox from service consent in every form.

## 3. Audit Logging

- [ ] Verify an audit log table exists. Check its schema includes: actor (user ID), action, resource type, resource ID, timestamp, and IP.
- [ ] List every route that reads, creates, updates, or deletes personal data (seller name, phone, email, NRIC, address, financial info). For each, verify it writes to the audit log.
- [ ] Check that audit log records cannot be modified or deleted — no UPDATE/DELETE Prisma calls on the audit log model.
- [ ] Verify audit logs do not contain full NRIC or unmasked sensitive data.

## 4. Subject Access Request (SAR) & Data Deletion

- [ ] Check that a SAR endpoint exists allowing sellers to export all their personal data.
- [ ] Verify the export includes: personal data, consent records, and audit trail.
- [ ] Check that a data deletion endpoint exists. Verify it performs hard DELETE on NRIC data (not soft-delete).
- [ ] Verify deletion cascades — deleting a seller removes their data from all related tables (listings, documents, consent records except withdrawal proof).

## 5. Data Retention Enforcement

- [ ] Search for scheduled jobs (cron, `node-cron`, `setInterval`, Prisma middleware) enforcing retention.
- [ ] Verify NRIC data has an automated deletion/redaction trigger tied to transaction completion + 30 days.
- [ ] Check that completed listing data has a defined retention period with automated cleanup.
- [ ] Identify any table containing personal data with no retention mechanism. Flag each as MEDIUM.

## 6. Financial Data Protection

- [ ] Find where asking price, loan balance, and other financial data is stored. Verify encryption at rest.
- [ ] Check that financial data is only accessible to the authenticated seller and authorized staff — not leaked in public listing pages or API responses.
- [ ] Verify financial fields are excluded from any public-facing Nunjucks templates or unauthenticated API routes.

## 7. Prisma — Injection & Data Leakage

- [ ] Search for every use of `$queryRaw`, `$queryRawUnsafe`, `$executeRaw`, `$executeRawUnsafe`. For each: verify inputs use `Prisma.sql` tagged template. Flag any string concatenation or template literal interpolation.
- [ ] Search for Prisma queries on seller-related models that include sensitive fields (password hash, TOTP secret, NRIC, financial data) in their `select` or `include`. Verify these are excluded from responses and template contexts.
- [ ] Check for `.findMany()` without `take`/pagination on any table containing personal data.

## 8. Nunjucks — XSS & Template Injection

- [ ] Find the Nunjucks environment configuration. Verify `autoescape: true` is explicitly set.
- [ ] Search all `.njk` / `.html` templates for the `| safe` filter. For each: determine if the value could be user-controlled. Flag any that are.
- [ ] Search for `nunjucks.renderString()` where the template string comes from user input (server-side template injection).
- [ ] Check error pages — verify they do not render raw error messages or stack traces into templates.

## 9. HTMX Endpoints — Auth & CSRF

- [ ] List every route that returns HTML fragments (HTMX partial responses). Verify each has authentication middleware.
- [ ] Check CSRF protection on all state-changing HTMX requests (`hx-post`, `hx-put`, `hx-delete`, `hx-patch`). Look for a CSRF token in headers or hidden fields and middleware validating it.
- [ ] Check if any HTMX endpoint reads `HX-Target` or `HX-Swap` from request headers and uses them server-side. Flag if found.

## 10. Express — Middleware & Configuration

- [ ] Verify `helmet` is installed and applied as middleware.
- [ ] Check CORS: is `origin` a specific allowlist or `*`? Flag `credentials: true` with wildcard origin.
- [ ] Verify `express.json()` and `express.urlencoded()` have a `limit` set (e.g., `'10kb'`).
- [ ] Check that a global error handler exists and does NOT send `err.stack` or `err.message` to the client in production.
- [ ] Verify `trust proxy` is configured correctly for reverse proxy setup (not `true` unconditionally).
- [ ] Check for `res.send()` / `res.json()` / `res.render()` calls that include raw user input without sanitization.

## 11. Authentication — bcrypt & TOTP

- [ ] Find bcrypt hash generation. Verify salt rounds >= 12.
- [ ] Find TOTP secret storage. Verify secrets are encrypted at rest, not plain text.
- [ ] Check rate limiting on: login endpoint, TOTP verification, password reset. Flag any that are missing.
- [ ] Verify sessions/tokens are invalidated on password change and TOTP re-enrollment.
- [ ] Check session cookie config: `httpOnly: true`, `secure: true`, `sameSite: 'strict'` or `'lax'`.
- [ ] List every POST/PUT/DELETE/PATCH route. Flag any that lack authentication middleware.

## 12. Authorization & Access Control

- [ ] For routes that access seller data by ID (e.g., `/listing/:id`, `/seller/:id`), verify the query checks that the requesting user owns that resource. Flag any route that fetches by ID without ownership verification (IDOR).
- [ ] Check that seller A cannot view or modify seller B's listings, data, or documents.
- [ ] Verify admin/staff routes (if any) are protected by role-based middleware and not accessible to regular sellers.

## 13. Secrets & Environment

- [ ] Search all `.ts`, `.js`, `.json`, `.yml`, `.yaml`, `.env`, `.env.*`, `Dockerfile`, `docker-compose.yml` for hardcoded: API keys, database connection strings, JWT/session secrets, TOTP encryption keys, SMTP credentials, NRIC encryption keys.
- [ ] Verify `.env` is in `.gitignore`. Check git history for accidental commits of `.env` (`git log --all --full-history -- .env`).
- [ ] Check `Dockerfile` for: `COPY .env`, `ENV` directives containing secrets, `ARG` with default secret values.
- [ ] Search all logging output for secrets or credentials being printed.

## 14. Input Validation

- [ ] Identify the validation library used (zod, joi, express-validator, or none). If none, flag as HIGH.
- [ ] For every POST/PUT/PATCH route, check that `req.body` fields are validated for type, length, and format before use.
- [ ] If file upload exists (e.g., property photos, documents): verify file type whitelist, size limit, and that uploads aren't stored in a publicly accessible directory with executable permissions.
- [ ] Search for `eval()`, `Function()`, `child_process.exec()` with user input. Flag any found as CRITICAL.
- [ ] Verify NRIC input is validated against the Singapore NRIC format (e.g., `^[STFGM]\d{7}[A-Z]$`) before storage.

## 15. Docker & Deployment

- [ ] Check `Dockerfile` runs the app as non-root (`USER node` or equivalent).
- [ ] Verify base image is slim (`node:xx-slim` or `node:xx-alpine`).
- [ ] Check `node_modules` is installed inside container via `npm ci`, not copied from host.
- [ ] Verify production `docker-compose.yml` does not expose database port (5432) to the host/public network.
- [ ] Check that health check endpoint exists and doesn't expose internal state or PII.

## 16. Dependencies

- [ ] Run `npm audit` and report HIGH or CRITICAL vulnerabilities.
- [ ] Check for outdated packages with known CVEs (especially Express, Prisma, Nunjucks, bcrypt, otplib).
- [ ] Flag any dependencies from non-npm sources (git URLs, local file paths).

## 17. DNC Registry (if applicable)

- [ ] If the app sends SMS or makes phone calls: verify DNC Registry check before outbound marketing messages.
- [ ] Check that transactional vs. marketing messages are distinguished in code.
- [ ] If no outbound messaging exists yet, verify no code path could send marketing messages without DNC safeguards.

---

## Output Format

Produce a summary table:

| # | Finding | Severity | File:Line | Recommendation |
|---|---------|----------|-----------|----------------|
| 1 | Full NRIC stored as plain text | CRITICAL | prisma/schema.prisma:45 | Encrypt with AES-256, store in separate table |
| 2 | ... | HIGH | ... | ... |

Then list total counts: X CRITICAL, X HIGH, X MEDIUM, X LOW, X PASS.

Prioritize fixes in order: CRITICAL → HIGH → MEDIUM → LOW.
