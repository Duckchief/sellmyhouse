# Security Audit Report — SellMyHouse.sg v2

**Date:** 2026-03-27
**Scope:** Security-focused audit of 255 TypeScript source files across 18 domain modules
**Method:** Parallel automated review covering auth/session, input validation, file uploads, CSRF/HTTP headers, encryption/secrets, rate limiting/access control

---

## Executive Summary

The codebase demonstrates strong security fundamentals: bcrypt cost-12 passwords, AES-256-GCM encryption, per-request CSP nonces, comprehensive rate limiting, defence-in-depth CSRF (double-submit + SameSite=strict), fail-closed ClamAV scanning, and consistent auth middleware chains. No critical exploitation paths were found — all findings require either a pre-existing compromise or specific environmental conditions.

**Totals: 0 Critical | 5 High | 13 Medium | 14 Low | 11 Info (positive)**

---

## High Severity

### H1. Production nginx missing security headers
- **File:** `docker/nginx/conf.d/production/production.conf`
- **Issue:** Zero security headers (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `HSTS`, `Permissions-Policy`) in the production nginx server block. Static assets served by nginx bypass Helmet entirely.
- **Fix:** Add to the production `server` block:
  ```nginx
  add_header X-Frame-Options "DENY" always;
  add_header X-Content-Type-Options "nosniff" always;
  add_header Referrer-Policy "strict-origin-when-cross-origin" always;
  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
  add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
  server_tokens off;
  ```

### H2. Missing `requireRole('seller')` on all viewing routes
- **File:** `src/domains/viewing/viewing.router.ts` (lines 30–305)
- **Issue:** All 12 seller viewing routes use only `requireAuth()` without `requireRole('seller')`. Any authenticated user (agent/admin) could call seller viewing endpoints. Service-layer ownership checks mitigate actual data leakage, but the principle of least privilege is violated.
- **Fix:** Add `requireRole('seller')` to all `/seller/viewings/*` routes.

### H3. `Math.random()` used for referral code generation
- **File:** `src/domains/content/content.service.ts` (line 457)
- **Issue:** Referral codes generated with `Math.random()` are predictable. Attackers could enumerate or forge referral attributions.
- **Fix:** Replace with `crypto.randomInt(REFERRAL_CHARSET.length)`.

### H4. No encryption key rotation mechanism
- **Files:** `src/domains/shared/encryption.ts`, `src/infra/security/key-provider.ts`
- **Issue:** Single `ENCRYPTION_KEY` for all text-field encryption (2FA secrets, agent settings). No key versioning, no re-encryption capability. A compromised key exposes all encrypted data permanently.
- **Fix:** Add version prefix to encrypted format (`v1:iv:tag:ciphertext`), support decrypting with old keys, implement background re-encryption job.

### H5. Portal listing `mark-posted` lacks ownership check
- **File:** `src/domains/property/portal.router.ts` (lines 166–188)
- **Issue:** `POST /agent/portal-listings/:id/mark-posted` doesn't verify the listing belongs to the calling agent. Any authenticated agent can mark any listing as posted.
- **Fix:** Pass agent ID/role to `markAsPosted()` and verify ownership in the service layer.

---

## Medium Severity

### M1. Session fixation — no session regeneration on login
- **File:** `src/domains/auth/auth.login.router.ts` (lines 77, 131)
- **Issue:** `req.logIn()` is called without first calling `req.session.regenerate()`. Pre-authenticated session IDs survive login.
- **Fix:** Call `req.session.regenerate()` before `req.logIn()` in all login paths.

### M2. 2FA enabled before user verifies TOTP code
- **File:** `src/domains/auth/auth.service.ts` (lines 191–233)
- **Issue:** `setup2FA` sets `twoFactorEnabled: true` and stores the secret in one step, before the user confirms they can produce a valid code. If setup is interrupted, the user is locked out.
- **Fix:** Split into two phases: store provisional secret with `twoFactorEnabled: false`, then enable after successful TOTP verification.

### M3. Password policy inconsistency (registration vs reset)
- **File:** `src/domains/auth/auth.validator.ts` (lines 3–39)
- **Issue:** Registration requires only 8 characters (no complexity). Password reset requires a letter + number. Users can register with `aaaaaaaa`.
- **Fix:** Apply the same complexity rules from `resetPasswordRules` to `registerValidation`.

### M4. Hardcoded fallback secrets in CSRF and HMAC modules
- **Files:** `src/infra/http/middleware/csrf.ts` (line 6), `src/domains/lead/verification.router.ts` (line 19)
- **Issue:** Both fall back to hardcoded strings (`'dev-csrf-secret'`, `'dev-secret'`) if `SESSION_SECRET` is unset. Although `validateEnv()` checks for this, these modules execute at import time, potentially before validation.
- **Fix:** Remove fallbacks; throw explicitly if secret is missing.

### M5. Avatar upload missing magic-byte validation and virus scan
- **File:** `src/domains/profile/profile.service.ts` (lines 22–36)
- **Issue:** Only upload flow that doesn't use `fileTypeFromBuffer()` or `scanBuffer()`. Relies on client-supplied `Content-Type` header only.
- **Fix:** Add `fileTypeFromBuffer()` check and `scanBuffer()` call before Sharp processing.

### M6. OTP scans stored without encryption at rest
- **File:** `src/domains/transaction/transaction.service.ts` (lines 454–458)
- **Issue:** OTP scans (containing personal details, signatures, financial terms) use `localStorage.save()` (plaintext) while CDD docs and seller docs use `encryptedStorage.save()` (AES-256-GCM).
- **Fix:** Use `encryptedStorage.save()` for OTP scans, store `wrappedKey` alongside the path.

### M7. Forms missing CSRF hidden input (non-HTMX fallback)
- **Files:** `src/views/pages/public/verify-email-error.njk` (line 10), `src/views/partials/admin/tutorial-row.njk` (lines 9–20)
- **Issue:** These `<form method="POST">` forms lack a `_csrf` hidden input. They rely on HTMX `hx-headers` but would fail CSRF validation if HTMX doesn't load.
- **Fix:** Add `<input type="hidden" name="_csrf" value="{{ csrfToken }}">` to each form.

### M8. GET-based unsubscribe performs state change
- **File:** `src/domains/notification/notification.router.ts` (lines 82–108)
- **Issue:** `GET /api/notifications/unsubscribe?token=...` withdraws marketing consent. Link preview bots or prefetching could unsubscribe users.
- **Fix:** Change to two-step: GET renders confirmation page, POST performs the unsubscribe.

### M9. No rate limiter on viewing OTP verification
- **File:** `src/domains/viewing/viewing.router.ts` (lines 369–384)
- **Issue:** `POST /view/:propertySlug/verify-otp` has no rate limiter. OTP codes could be brute-forced.
- **Fix:** Apply a rate limiter (keyed by IP or bookingId), similar to `totpRateLimiter`.

### M10. Stale role in session after admin deactivation
- **File:** `src/infra/http/middleware/passport.ts` (lines 66–77)
- **Issue:** Full `AuthenticatedUser` (including `role`) serialized to session. Role/active changes by admin don't take effect until session expires (up to 24h).
- **Fix:** Call `invalidateUserSessions()` when roles or active status change, or look up user on each request.

### M11. Session cookie `secure` flag only in `NODE_ENV=production`
- **File:** `src/infra/http/middleware/session.ts` (line 24)
- **Issue:** Staging runs HTTPS but if `NODE_ENV=staging`, cookies lack `Secure` flag.
- **Fix:** Use `secure: process.env.NODE_ENV !== 'development'`.

### M12. Staging nginx missing most security headers
- **File:** `docker/nginx/conf.d/staging/staging.conf`
- **Issue:** Only has `X-Frame-Options` and `X-Robots-Tag`. Missing `X-Content-Type-Options`, `HSTS`, `Referrer-Policy`, `Permissions-Policy`.
- **Fix:** Mirror production headers (from H1) plus keep `X-Robots-Tag: noindex`.

### M13. HSTS missing `preload` directive
- **File:** `src/infra/http/app.ts` (lines 118–121)
- **Issue:** HSTS configured without `preload` flag. Cannot be submitted to browser preload lists.
- **Fix:** Add `preload: true` and submit to hstspreload.org.

---

## Low Severity

### L1. `localStorage` has no path traversal guard
- **File:** `src/infra/storage/local-storage.ts` (lines 8–23)
- **Issue:** `path.join(UPLOADS_DIR, filePath)` without validating resolved path stays within `UPLOADS_DIR`. Callers use safe server-generated paths, but no defence-in-depth.
- **Fix:** Add `if (!path.resolve(fullPath).startsWith(path.resolve(UPLOADS_DIR) + path.sep)) throw`.

### L2. JWT unsubscribe tokens lack algorithm restriction
- **Files:** `src/domains/notification/notification.service.ts` (line 378), `notification.router.ts` (line 89)
- **Issue:** `jwt.verify()` called without `{ algorithms: ['HS256'] }`.
- **Fix:** Add `{ algorithms: ['HS256'] }` to all `jwt.verify()` calls.

### L3. Account enumeration via registration (409 vs 302 status)
- **File:** `src/domains/auth/auth.service.ts` (lines 33–35)
- **Issue:** Registration returns different HTTP status for existing vs new accounts.
- **Fix:** Always return success; send "you already have an account" email to existing address.

### L4. HTML injection in account setup email
- **File:** `src/domains/auth/auth.service.ts` (lines 500–508)
- **Issue:** Seller name interpolated into HTML email without escaping.
- **Fix:** HTML-encode `name` before interpolation.

### L5. Backup code verification not rate-limited at application level
- **File:** `src/domains/auth/auth.service.ts` (lines 281–313)
- **Issue:** Unlike TOTP, backup code failures don't increment `failedTwoFactorAttempts`.
- **Fix:** Increment the counter on backup code failure.

### L6. Commission invoices stored without encryption
- **File:** `src/domains/transaction/transaction.service.ts` (lines 505–508)
- **Issue:** Invoice PDFs use `localStorage.save()` instead of `encryptedStorage.save()`.
- **Fix:** Use encrypted storage for consistency.

### L7. Email HTML content logged in dev stub
- **File:** `src/infra/email/system-mailer.ts` (lines 16, 22)
- **Issue:** Full email body (containing secret tokens/links) logged at `info` level when SMTP is not configured.
- **Fix:** Log only `to` and `subject`, never `html` body.

### L8. `NotFoundError` exposes entity IDs to clients
- **File:** `src/domains/shared/errors.ts` (lines 15–16)
- **Issue:** Error message includes entity ID (e.g., "Seller not found: clx123...") and is sent to clients.
- **Fix:** Strip ID from client-facing message; keep in logs only.

### L9. Dev route uses negative `NODE_ENV` guard
- **File:** `src/domains/lead/verification.router.ts` (lines 59–70)
- **Issue:** `!== 'production'` means route is active in staging and any misconfigured env.
- **Fix:** Use `=== 'development'` (positive match).

### L10. Correction requests visible to all agents
- **File:** `src/domains/agent/agent.router.ts` (lines 293–312)
- **Issue:** `getPendingCorrectionRequests()` called without agent filter. Any agent sees all corrections.
- **Fix:** Pass `getAgentFilter(user)` to filter by assigned agent.

### L11. Viewing slot bulk delete accepts unvalidated array elements
- **File:** `src/domains/viewing/viewing.router.ts` (lines 152–156)
- **Issue:** `slotIds` array elements not validated as strings.
- **Fix:** Add `slotIds.every(id => typeof id === 'string' && id.length > 0)`.

### L12. No input validation on public HDB API query parameters
- **File:** `src/domains/public/public.router.ts` (lines 40–42, 72–74)
- **Issue:** `town`, `flatType`, `storeyRange` accepted without validating against known enums.
- **Fix:** Validate against `HDB_TOWNS` and `HDB_FLAT_TYPES`.

### L13. SSL cipher suite too broad / missing `ssl_prefer_server_ciphers`
- **Files:** Both nginx configs
- **Issue:** `HIGH:!aNULL:!MD5` includes older ciphers; no server cipher preference.
- **Fix:** Use explicit modern ECDHE cipher list with `ssl_prefer_server_ciphers on`.

### L14. Financial report GET missing `requireRole('seller')`
- **File:** `src/domains/property/financial.router.ts` (lines 210–226)
- **Issue:** Same pattern as H2 but for a single route.
- **Fix:** Add `requireRole('seller')`.

---

## Positive Findings (Things Done Well)

| Area | Details |
|------|---------|
| **Bcrypt** | Cost factor 12 everywhere; dummy-hash timing attack mitigation on login |
| **AES-256-GCM** | Correct IV/tag handling; per-file data keys in encrypted storage |
| **CSP** | Per-request nonces via `crypto.randomBytes(16)` |
| **CSRF** | Double-submit cookie + `__Host-` prefix + SameSite=strict |
| **Session** | httpOnly, sameSite=strict, custom cookie name, `saveUninitialized: false` |
| **ClamAV** | Fail-closed in production; all major upload flows scanned |
| **File uploads** | Memory storage (no temp files); magic-byte validation; server-generated filenames |
| **No raw SQL** | Zero `$queryRawUnsafe`/`$executeRawUnsafe`; all queries parameterised |
| **No command injection** | Zero `exec`/`spawn`/`child_process` usage |
| **No SSTI** | No `renderString()`/`compile()`/`fromString()`; templates from disk only |
| **Nunjucks autoescape** | `autoescape: true` globally; `| safe` used only with `| dump` for JSON |
| **Admin protection** | All admin routes: `requireAuth() + requireRole('admin') + requireTwoFactor()` |
| **No mass assignment** | All routes explicitly destructure expected fields |
| **IDOR protection** | Consistent ownership checks via `req.user.id` and `getAgentFilter()` |
| **Rate limiting** | Auth (5/15min), TOTP (10/15min), API (100/min), leads (3/hr), global (300/min) |
| **Trust proxy** | Correctly set to `1` for single-proxy architecture |
| **Password reset** | `crypto.randomBytes(64)`, SHA-256 hashed, 1hr expiry, single-use, all sessions invalidated |
| **2FA** | Secrets encrypted at rest; 5-attempt lockout; backup codes bcrypt-hashed |
| **Error handling** | No stack traces or SQL errors leaked to clients; ConflictError messages redacted |
| **Audit logging** | All file operations, auth events, and data changes logged |
| **No CORS** | Correct for server-rendered HTMX app; same-origin enforced |

---

## Recommended Fix Priority

**Immediate (before next deploy):**
1. H1 — Nginx security headers (production)
2. M4 — Remove hardcoded fallback secrets
3. M1 — Session regeneration on login
4. H5 — Portal listing ownership check

**Short-term (next sprint):**
5. H2 — Missing role checks on viewing routes
6. M5 — Avatar upload validation parity
7. M6 — OTP scan encryption
8. M2 — 2FA two-phase setup
9. M7 — CSRF hidden inputs on forms
10. M8 — GET unsubscribe → POST
11. M9 — OTP verification rate limiter
12. M3 — Password policy consistency

**Medium-term (backlog):**
13. H3 — Crypto-secure referral codes
14. H4 — Encryption key rotation
15. M10 — Session invalidation on role change
16. All Low findings
