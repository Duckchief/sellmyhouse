# Error Page Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace raw JSON error responses with a warm, friendly HTML error page for browser navigation requests.

**Architecture:** A single `pages/error.njk` template extends `layouts/base.njk` and renders per-code humorous copy. The `error-handler.ts` middleware detects browser requests (no `hx-request` header + `Accept: text/html`) and renders the page instead of JSON. HTMX inline errors and JSON API responses are unchanged.

**Tech Stack:** Nunjucks, Express, Tailwind CSS

---

## Chunk 1: Error page template and handler update

### Task 1: Create `pages/error.njk`

**Files:**
- Create: `src/views/pages/error.njk`

- [ ] **Step 1: Create the error page template**

```nunjucks
{% extends "layouts/base.njk" %}

{% block title %}{{ statusCode }} — SellMyHomeNow{% endblock %}

{% block body %}
<div class="min-h-screen bg-bg flex items-center justify-center px-4">
  <div class="max-w-md w-full text-center">

    {% if statusCode == 401 %}
      <div class="text-6xl mb-4">🚪</div>
      <p class="text-sm text-gray-400 mb-1">{{ "Error" | t }} {{ statusCode }}</p>
      <h1 class="text-2xl font-bold text-gray-900 mb-3">{{ "Looks like you wandered off!" | t }}</h1>
      <p class="text-gray-500 mb-8">{{ "You've been away a while and your session expired. Totally normal — it happens to the best of us." | t }}</p>
      <a href="/auth/login"
        class="inline-block px-6 py-3 rounded-md text-white font-medium bg-[#c8553d] hover:bg-[#b04a34] transition-colors">
        {{ "Log back in" | t }}
      </a>

    {% elif statusCode == 403 %}
      <div class="text-6xl mb-4">🔒</div>
      <p class="text-sm text-gray-400 mb-1">{{ "Error" | t }} {{ statusCode }}</p>
      <h1 class="text-2xl font-bold text-gray-900 mb-3">{{ "Nothing to see here!" | t }}</h1>
      <p class="text-gray-500 mb-8">{{ "You don't have permission to view this page. If you think that's a mistake, give us a shout." | t }}</p>
      <a href="/"
        class="inline-block px-6 py-3 rounded-md text-white font-medium bg-[#c8553d] hover:bg-[#b04a34] transition-colors">
        {{ "Go to dashboard" | t }}
      </a>

    {% elif statusCode == 404 %}
      <div class="text-6xl mb-4">🏠</div>
      <p class="text-sm text-gray-400 mb-1">{{ "Error" | t }} {{ statusCode }}</p>
      <h1 class="text-2xl font-bold text-gray-900 mb-3">{{ "This page seems to have moved out already." | t }}</h1>
      <p class="text-gray-500 mb-8">{{ "We can't find what you're looking for — it may have been removed or the link is wrong." | t }}</p>
      <a href="/"
        class="inline-block px-6 py-3 rounded-md text-white font-medium bg-[#c8553d] hover:bg-[#b04a34] transition-colors">
        {{ "Go home" | t }}
      </a>

    {% elif statusCode == 500 %}
      <div class="text-6xl mb-4">🔧</div>
      <p class="text-sm text-gray-400 mb-1">{{ "Error" | t }} {{ statusCode }}</p>
      <h1 class="text-2xl font-bold text-gray-900 mb-3">{{ "Oops, we tripped over something." | t }}</h1>
      <p class="text-gray-500 mb-8">{{ "An unexpected error occurred on our end. We've been notified and we're on it." | t }}</p>
      <a href="/"
        class="inline-block px-6 py-3 rounded-md text-white font-medium bg-[#c8553d] hover:bg-[#b04a34] transition-colors">
        {{ "Go home" | t }}
      </a>

    {% else %}
      <div class="text-6xl mb-4">😬</div>
      <p class="text-sm text-gray-400 mb-1">{{ "Error" | t }} {{ statusCode }}</p>
      <h1 class="text-2xl font-bold text-gray-900 mb-3">{{ "Something went a bit sideways." | t }}</h1>
      <p class="text-gray-500 mb-8">{{ "An error occurred. Our team has been notified." | t }}</p>
      <a href="/"
        class="inline-block px-6 py-3 rounded-md text-white font-medium bg-[#c8553d] hover:bg-[#b04a34] transition-colors">
        {{ "Go home" | t }}
      </a>
    {% endif %}

  </div>
</div>
{% endblock %}
```

- [ ] **Step 2: Verify the file exists**

```bash
ls src/views/pages/error.njk
```

Expected: file listed with no error.

---

### Task 2: Update `error-handler.ts` to render HTML for browser requests

**Files:**
- Modify: `src/infra/http/middleware/error-handler.ts`

Current file for reference:
```ts
import { Request, Response, NextFunction } from 'express';
import { logger } from '../../logger';
import { AppError, ConflictError } from '../../../domains/shared/errors';

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    logger.warn({ err, path: req.path }, `${err.name}: ${err.message}`);

    const clientMessage =
      err instanceof ConflictError
        ? 'Unable to process your submission. Please try again.'
        : err.message;

    if (req.headers['hx-request']) {
      return res.status(err.statusCode).render('partials/error-message', {
        message: clientMessage,
      });
    }

    return res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: clientMessage,
      },
    });
  }

  logger.error({ err, path: req.path }, 'Unhandled error');

  if (req.headers['hx-request']) {
    return res.status(500).render('partials/error-message', {
      message: 'An unexpected error occurred',
    });
  }

  return res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
  });
}
```

- [ ] **Step 3: Write the failing test**

Add to `src/infra/http/middleware/__tests__/error-handler.test.ts` (create file if it doesn't exist):

```ts
import { Request, Response, NextFunction } from 'express';
import { errorHandler } from '../error-handler';
import { UnauthorizedError, NotFoundError } from '../../../../domains/shared/errors';

function mockRes() {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    render: jest.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    path: '/test',
    headers: {},
    ...overrides,
  } as unknown as Request;
}

const next = jest.fn() as unknown as NextFunction;

describe('errorHandler', () => {
  describe('browser requests (no hx-request, Accept: text/html)', () => {
    it('renders error page for 401', () => {
      const req = mockReq({ headers: { accept: 'text/html' } });
      const res = mockRes();
      errorHandler(new UnauthorizedError('Authentication required'), req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.render).toHaveBeenCalledWith('pages/error', expect.objectContaining({ statusCode: 401 }));
    });

    it('renders error page for unhandled 500', () => {
      const req = mockReq({ headers: { accept: 'text/html' } });
      const res = mockRes();
      errorHandler(new Error('boom'), req, res, next);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.render).toHaveBeenCalledWith('pages/error', expect.objectContaining({ statusCode: 500 }));
    });
  });

  describe('HTMX requests (hx-request header present)', () => {
    it('renders inline partial for AppError', () => {
      const req = mockReq({ headers: { 'hx-request': '1', accept: 'text/html' } });
      const res = mockRes();
      errorHandler(new NotFoundError('Not found'), req, res, next);
      expect(res.render).toHaveBeenCalledWith('partials/error-message', expect.anything());
    });
  });

  describe('API requests (Accept: application/json)', () => {
    it('returns JSON for AppError', () => {
      const req = mockReq({ headers: { accept: 'application/json' } });
      const res = mockRes();
      errorHandler(new UnauthorizedError('Authentication required'), req, res, next);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.anything() }));
    });

    it('returns JSON for unhandled error', () => {
      const req = mockReq({ headers: { accept: 'application/json' } });
      const res = mockRes();
      errorHandler(new Error('boom'), req, res, next);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.anything() }));
    });
  });
});
```

- [ ] **Step 4: Run the test to confirm it fails**

```bash
npx jest src/infra/http/middleware/__tests__/error-handler.test.ts --no-coverage
```

Expected: FAIL — `render` called with `partials/error-message` or `json` instead of `pages/error`.

- [ ] **Step 5: Update `error-handler.ts`**

Replace the full file content with:

```ts
import { Request, Response, NextFunction } from 'express';
import { logger } from '../../logger';
import { AppError, ConflictError } from '../../../domains/shared/errors';

function isBrowserRequest(req: Request): boolean {
  return !req.headers['hx-request'] && (req.headers['accept'] ?? '').includes('text/html');
}

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    logger.warn({ err, path: req.path }, `${err.name}: ${err.message}`);

    const clientMessage =
      err instanceof ConflictError
        ? 'Unable to process your submission. Please try again.'
        : err.message;

    if (req.headers['hx-request']) {
      return res.status(err.statusCode).render('partials/error-message', {
        message: clientMessage,
      });
    }

    if (isBrowserRequest(req)) {
      return res.status(err.statusCode).render('pages/error', {
        statusCode: err.statusCode,
        code: err.code,
      });
    }

    return res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: clientMessage,
      },
    });
  }

  logger.error({ err, path: req.path }, 'Unhandled error');

  if (req.headers['hx-request']) {
    return res.status(500).render('partials/error-message', {
      message: 'An unexpected error occurred',
    });
  }

  if (isBrowserRequest(req)) {
    return res.status(500).render('pages/error', {
      statusCode: 500,
      code: 'INTERNAL_ERROR',
    });
  }

  return res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
  });
}
```

- [ ] **Step 6: Run the tests to confirm they pass**

```bash
npx jest src/infra/http/middleware/__tests__/error-handler.test.ts --no-coverage
```

Expected: all 5 tests PASS.

- [ ] **Step 7: Run full test suite to check for regressions**

```bash
npm test
```

Expected: all tests pass (suite count unchanged or higher).

- [ ] **Step 8: Commit**

```bash
git add src/views/pages/error.njk src/infra/http/middleware/error-handler.ts src/infra/http/middleware/__tests__/error-handler.test.ts
git commit -m "feat: add friendly HTML error page for browser navigation errors"
```

- [ ] **Step 9: Push**

```bash
git push
```
