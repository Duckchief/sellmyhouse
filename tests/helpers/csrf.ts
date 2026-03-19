// tests/helpers/csrf.ts
import type { SuperAgentTest } from 'supertest';

/**
 * Makes a GET /health request through the given supertest agent to establish the
 * CSRF cookie, then returns the token value.
 *
 * csrf-csrf (double-submit cookie pattern) sets the _csrf cookie on the first GET.
 * The same value must be sent as x-csrf-token on all mutating requests.
 */
export async function getCsrfToken(agent: SuperAgentTest): Promise<string> {
  const res = await agent.get('/health');
  const rawCookies: unknown = res.headers['set-cookie'];
  const cookies: string[] = Array.isArray(rawCookies)
    ? rawCookies
    : typeof rawCookies === 'string'
      ? [rawCookies]
      : [];

  const csrfCookie = cookies.find((c) => c.startsWith('_csrf='));
  if (!csrfCookie) {
    throw new Error('CSRF cookie (_csrf) not found in GET /health response.');
  }

  const raw = csrfCookie.split(';')[0].replace(/^_csrf=/, '');
  return decodeURIComponent(raw);
}

/**
 * Wraps an agent's mutating HTTP methods to automatically include the CSRF token
 * header on every call, so test bodies don't need to be updated individually.
 */
export function withCsrf(agent: SuperAgentTest, csrfToken: string): SuperAgentTest {
  const methods = ['post', 'put', 'patch', 'delete'] as const;
  for (const method of methods) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const original = (agent[method] as any).bind(agent);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (agent as any)[method] = (url: string) => original(url).set('x-csrf-token', csrfToken);
  }
  return agent;
}
