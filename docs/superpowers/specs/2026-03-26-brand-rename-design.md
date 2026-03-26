# Brand Rename: sellmyhomenow.sg → sellmyhouse.sg

## Summary

Rename the platform brand, domain, internal abbreviation, and all references across the entire codebase. Nothing is in production, so this is a clean rename with no migration risk.

## Rename Rules

Replacements applied in this order to avoid partial-match issues:

| # | Find | Replace | Scope |
|---|------|---------|-------|
| 1 | `sellmyhomenow-v2` | `sellmyhouse-v2` | Package name, deploy directory path |
| 2 | `sellmyhomenow_dev` | `smh_dev` | Database name (env, Docker, CI, test helpers) |
| 3 | `sellmyhomenow_test` | `smh_test` | Test database name (env, CI, test helpers, Playwright) |
| 4 | `sellmyhomenow.sg` | `sellmyhouse.sg` | Domain references (templates, emails, docs, privacy/terms) |
| 5 | `SellMyHomeNow.sg` | `SellMyHouse.sg` | Branded display name with domain |
| 6 | `SellMyHomeNow` | `SellMyHouse` | Brand name without domain (email subjects, TOTP issuer, titles, docs) |
| 7 | `SellMyHome` | `SellMyHouse` | Bare brand fragment (header template split tokens, manifest short_name) |
| 8 | `sellmyhomenow` | `sellmyhouse` | Any remaining lowercase references |
| 9 | `smhn` | `smh` | Internal abbreviation (DB user, DB password prefix, session cookie, Docker, CI, cache key, deploy user) |

**Note on Rule 7:** The public header renders the brand as split i18n tokens (`{{ "SellMyHome" | t }}` + `{{ "Now" | t }}`). After Rule 6 replaces `SellMyHomeNow`, Rule 7 catches the bare `SellMyHome` fragment. The header template will also need a manual edit to change `{{ "Now" | t }}` to remove the "Now" token and update the span styling for the new brand.

**Note on Rule 7 and manifest.json:** `public/manifest.json` has `"short_name": "SellMyHome"` — Rule 7 catches this.

## Affected File Categories

### Configuration (~10 files)
- `package.json` — name field
- `.env.example` — DATABASE_URL, DATABASE_URL_TEST, SMTP_FROM
- `playwright.config.ts` — test DB URL
- `public/manifest.json` — PWA app name
- `public/sw.js` — cache name

### Docker & CI (~4 files)
- `docker/docker-compose.yml` — production image name (`local/sellmyhomenow`)
- `docker/docker-compose.dev.yml` — POSTGRES_USER, POSTGRES_PASSWORD, pg_isready
- `docker/docker-compose.test.yml` — same
- `.github/workflows/deploy.yml` — DB name, user, password, DATABASE_URL, VPS deploy directory (`~/sellmyhomenow-v2`)

### Source Code (~25 files)
- `src/infra/http/middleware/session.ts` — cookie name
- `src/domains/auth/` — TOTP issuer, email subjects/bodies, reset URLs
- `src/domains/admin/` — agent account emails, SMTP_FROM fallback
- `src/domains/lead/` — verification emails
- `src/domains/content/` — AI prompt attribution
- `src/domains/offer/` — AI system prompt
- `src/domains/viewing/` — OTP message
- `src/domains/transaction/` — referral links
- `src/domains/notification/` — templates, email provider default subject
- `src/domains/shared/ai/prompts/` — financial narrative prompt

### Templates (~35 files)
- `src/views/layouts/base.njk` — `<title>` default
- `src/views/partials/` — header, footer, public footer (**public header needs manual edit**: brand is split into `SellMyHome` + `Now` i18n tokens with a coloured span — must be restructured for new brand)
- `src/views/pages/public/` — home, privacy, terms, market-report, maintenance, testimonials
- `src/views/pages/auth/` — login, register, setup-account, forgot/reset password, 2fa, verify-email
- `src/views/pages/seller/` — dashboard, onboarding, documents, financial, notifications, referral, tutorials
- `src/views/pages/profile/` — index, index-admin
- `src/views/pages/agent/` — settings
- `src/views/pages/` — error, placeholder, unsubscribe
- `src/views/emails/base.njk` — email header/footer
- `src/views/public/viewing-booking.njk` — consent text
- `public/offline.html` — offline page title

### Tests (~15 files)
- `tests/helpers/set-test-env.ts`, `setup.ts`, `prisma.ts` — DB URLs
- `tests/integration/*.test.ts` — DB URLs, brand assertions
- `tests/e2e/*.spec.ts` — DB URLs
- `src/domains/*/` — co-located unit tests with brand strings

### Seeds & Scripts (~2 files)
- `scripts/devseed.ts` — agent email addresses
- `prisma/seeds/system-settings.ts` — platform_name, support_email

### Documentation (~30+ files)
- `CLAUDE.md` — project description
- `docs/phase-0-shared-context.md` through `docs/phase-6-*.md`
- `docs/DEPLOYMENT.md`
- `docs/superpowers/specs/*.md`
- `docs/superpowers/plans/*.md`
- `docs/plans/*.md`

## Database Recreation

Since nothing is in production, tear down and recreate with new names. The Docker Compose files define the Postgres user/password, so the containers must be recreated first.

```bash
# 1. Stop and remove old containers + volumes
docker compose -f docker/docker-compose.dev.yml down -v
docker compose -f docker/docker-compose.test.yml down -v

# 2. Apply all file changes (rename rules above)

# 3. Start new containers (creates new user/db from updated compose files)
docker compose -f docker/docker-compose.dev.yml up -d
docker compose -f docker/docker-compose.test.yml up -d

# 4. Run migrations
npx prisma migrate deploy

# 5. Seed dev database
npx prisma db seed
```

## Post-Rename Steps

- Run `npm install` to regenerate `package-lock.json` with the new package name
- Active dev sessions will be invalidated by the cookie rename (`smhn.sid` → `smh.sid`) — just log in again

## Out of Scope

- **Local directory rename** (`sellmyhomenow-v2` → `sellmyhouse-v2`) — manual step, affects git remotes and IDE config
- **VPS directory rename** (`~/sellmyhomenow-v2` → `~/sellmyhouse-v2`) — must be done on the server before deploying with the updated deploy.yml
- **DNS/email setup** — infrastructure task, not code
- **Git remote URL** — depends on whether the GitHub repo is also renamed
- **Existing migration file contents** — SQL in migration files references table/column names, not brand names. No changes needed.
- **MEMORY.md** — auto-memory references to `smhn` and `sellmyhomenow` will be updated separately

## Verification

Run all checks AFTER all replacements (including docs) are complete:

1. `grep -ri "sellmyhomenow" --exclude-dir=node_modules --exclude-dir=.git .` — zero hits
2. `grep -ri "smhn" --exclude-dir=node_modules --exclude-dir=.git .` — zero hits
3. `npm install` — regenerate package-lock.json
4. `npm run build` — TypeScript compiles, Tailwind builds
5. `npm test` — all unit tests pass
6. `npm run test:integration` — all integration tests pass (requires new DB containers)
7. Manual spot-check: load home page, check title, header, footer, privacy page
