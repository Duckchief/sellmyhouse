# Code Quality Review — Design Spec

**Date:** 2026-03-28
**Status:** Approved
**Scope:** Full codebase (~160 source files, ~30k lines, 17 domains + infra)

## Goal

Identify bugs, logic errors, race conditions, error handling gaps, and missing validation across the entire codebase. Produce a consolidated findings report, then execute fixes domain by domain with review checkpoints.

## Phase 1: Review & Report

### Methodology

Parallel review agents, each assigned a batch of related domains. Each agent reads all non-test source files in its assigned domains and produces a findings list.

### Review Categories

Each agent evaluates code against all of these:

1. **Bugs** — logic errors, wrong conditions, off-by-one, undefined access, dead code paths that mask failures
2. **Race conditions** — concurrent DB operations without transactions, TOCTOU issues, parallel request state conflicts
3. **Error handling gaps** — unhandled promise rejections, swallowed errors, missing try/catch in async paths, generic catch-alls that hide real failures
4. **Missing validation** — unchecked user input reaching DB/business logic, missing type coercion, boundary conditions
5. **State machine violations** — invalid status transitions, missing guard checks
6. **Data integrity** — missing DB transactions where multiple writes must be atomic, orphaned records
7. **Security gaps** — auth bypass paths, injection vectors, improper access control. May overlap with 2026-03-27 security audit findings if those fixes were incomplete; flag regardless.

### Threshold

Aggressive — flag anything ≥50% likely to be a real issue. False positives are acceptable; false negatives are not.

### Agent Batches

| Batch | Domains | Focus |
|-------|---------|-------|
| 1 | auth, agent | Session/auth security, agent CRUD |
| 2 | transaction, offer | Core business flow, financial data, state machines |
| 3 | seller, compliance | PII handling, document uploads, data lifecycle/purge |
| 4 | lead, viewing, notification | Customer-facing flows, messaging |
| 5 | property, hdb, content | Data/content domains |
| 6 | admin, profile, agent-settings, public, review, shared | Supporting domains + shared utilities |
| 7 | src/infra/ | Middleware, jobs, storage, security, caching, email |

### Finding Format

Each finding is reported as:

```
### [SEVERITY] Category — Short description
- **File:** path/to/file.ts:line
- **Category:** Bugs | Race conditions | Error handling | Validation | State machine | Data integrity | Security
- **Severity:** Critical | High | Medium | Low
- **Description:** What the issue is and why it matters
- **Suggested fix:** Brief approach to resolving the issue
```

### Report Structure

All agent findings are consolidated into a single report: `docs/superpowers/reports/2026-03-28-code-quality-findings.md`

Report sections:
1. Executive summary (total findings by severity and category)
2. Critical findings (immediate attention)
3. High findings
4. Medium findings
5. Low findings
6. Appendix: files reviewed per batch

## Phase 2: Fix Execution

### Approach

- Fix in severity order: Critical → High → Medium → Low
- Group fixes by domain for atomic commits
- Run `npm test && npm run test:integration` after each domain's fixes
- User review checkpoint between each domain batch
- Each fix references the finding ID from the report

### Model Selection

- Opus for complex domains (auth, transaction, offer, compliance)
- Sonnet for straightforward domains (content, hdb, property, public)
- User switches as needed during execution

### Branch Strategy

- Create `fix/code-quality-review` branch from `staging`
- One commit per domain batch
- PR into `staging` when all fixes are complete

## Out of Scope

- Test file quality (focus is on source code)
- Performance optimization (separate initiative)
- Frontend/template quality (Nunjucks templates)
- Adding new tests (unless needed to verify a fix)
- Refactoring or architectural changes
