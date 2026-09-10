import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import ts from 'typescript';
import { aiClient, aiRoute } from '../src/templates/ai.js';
import { browserClient, serverClient, sessionRefresh, requestEntry } from '../src/templates/supabase.js';
import { analyzeSource } from '../src/lib/analyze.js';
import { providers, type Provider } from '../src/lib/providers.js';
const realRequire = createRequire(import.meta.url);
function loadRoute(auth: 'supabase' | 'token', authenticated = true) {
  const complete = vi.fn(async () => ({ choices: [{ message: { content: 'Test response' } }] }));
  class APIError extends Error { status = 429; }
  const fakeOpenAI = { APIError };
  const output = ts.transpileModule(aiRoute(auth), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const exports: { POST?: (request: Request) => Promise<Response> } = {};
  const require = (name: string): unknown => {
    if (name === 'server-only') return {};
    if (name === 'node:crypto') return realRequire(name);
    if (name === 'openai') return fakeOpenAI;
    if (name.includes('lib/ai')) return { getAIClient: () => ({ chat: { completions: { create: complete } } }), getAIModel: () => 'gpt-4o-mini' };
    if (name.includes('lib/supabase')) return { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: authenticated ? { id: 'user' } : null }, error: null }) } }) };
    throw new Error('Unexpected generated import');
  };
  const token = 'test-token-with-at-least-32-characters';
  new Function('require', 'exports', 'process', output)(require, exports, { env: { AI_ROUTE_TOKEN: token } });
  return { POST: exports.POST!, complete, APIError, token };
}
function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://app.example/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
}
describe('generated AI routes', () => {
  it('requires authentication before contacting the provider', async () => {
    const route = loadRoute('token');
    expect((await route.POST(request({ prompt: 'hi' }))).status).toBe(401);
    expect(route.complete).not.toHaveBeenCalled();
  });
  it('works for authenticated requests and rejects invalid/oversized JSON', async () => {
    const route = loadRoute('token'), headers = { Authorization: `Bearer ${route.token}` };
    const result = await route.POST(request({ prompt: 'hi' }, headers));
    expect(result.status).toBe(200); expect(await result.json()).toEqual({ text: 'Test response' });
    expect((await route.POST(request({ prompt: '' }, headers))).status).toBe(400);
    expect((await route.POST(request({ prompt: 'x'.repeat(20_000) }, headers))).status).toBe(400);
  });
  it('requires a Supabase user and same-origin CSRF protection', async () => {
    const anonymous = loadRoute('supabase', false);
    expect((await anonymous.POST(request({ prompt: 'hi' }, { Origin: 'https://app.example' }))).status).toBe(401);
    const route = loadRoute('supabase');
    expect((await route.POST(request({ prompt: 'hi' }))).status).toBe(403);
    expect((await route.POST(request({ prompt: 'hi' }, { Origin: 'https://evil.example' }))).status).toBe(403);
    expect((await route.POST(request({ prompt: 'hi' }, { Origin: 'https://app.example' }))).status).toBe(200);
  });
  it('hides provider errors', async () => {
    const route = loadRoute('token'); route.complete.mockRejectedValueOnce(new Error('upstream-secret'));
    const response = await route.POST(request({ prompt: 'hi' }, { Authorization: `Bearer ${route.token}` }));
    expect(response.status).toBe(502); expect(await response.text()).not.toContain('upstream-secret');
  });
  it.each(Object.keys(providers) as Provider[])('generates server-only %s clients with correct endpoints', provider => {
    const code = aiClient(provider), source = analyzeSource('lib/ai/client.ts', code);
    expect(source.serverOnly).toBe(true); expect(code).toContain(providers[provider].baseURL);
    expect(source.env.map(e => e.key)).toContain(providers[provider].key);
    expect(code).not.toContain('NEXT_PUBLIC_');
  });
});
it('generates separate cookie-aware Supabase clients and version-specific entry points', () => {
  expect(analyzeSource('client.ts', browserClient).client).toBe(true);
  expect(analyzeSource('server.ts', serverClient).serverOnly).toBe(true);
  expect(serverClient).toContain('await cookies()'); expect(sessionRefresh).toContain('request.cookies.set');
  expect(sessionRefresh).toContain('response.cookies.set'); expect(sessionRefresh).toContain('getUser()');
  expect(requestEntry('proxy')).toContain('function proxy(');
  expect(requestEntry('middleware')).toContain('function middleware(');
});
