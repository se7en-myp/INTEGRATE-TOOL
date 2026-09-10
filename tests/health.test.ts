import { describe, expect, it, vi } from 'vitest';
import { checkAI, checkSupabase, firstBuildError, HealthFailure, runChecklist } from '../src/lib/health.js';
import { providers, type Provider } from '../src/lib/providers.js';
const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_fixture' };
function fetchMock(body: unknown, status = 200) { return vi.fn<typeof fetch>().mockResolvedValue(Response.json(body, { status })); }
it('streams results in sequence and never executes checks after a failure', async () => {
  const events: string[] = [], later = vi.fn();
  const success = await runChecklist([
    { name: 'one', run: async () => 'ok' },
    { name: 'two', run: async () => { throw new HealthFailure('broken', 'repair it'); } },
    { name: 'three', run: later },
  ], { start: name => events.push('start ' + name), pass: name => events.push('pass ' + name), fail: name => events.push('fail ' + name) });
  expect(success).toBe(false); expect(later).not.toHaveBeenCalled();
  expect(events).toEqual(['start one', 'pass one', 'start two', 'fail two']);
});
describe('Supabase runtime query', () => {
  it('queries one row with the publishable key and does not display data', async () => {
    const fetcher = fetchMock([{ private: 'never-display-this' }]);
    const result = await checkSupabase(env, 'healthcheck', 'public', fetcher);
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://example.supabase.co/rest/v1/healthcheck?select=*&limit=1');
    const options = fetcher.mock.calls[0]?.[1];
    expect(options?.headers).toEqual({ apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, Accept: 'application/json', 'Accept-Profile': 'public' });
    expect(options?.redirect).toBe('error'); expect(result).not.toContain('never-display-this');
  });
  it('explains empty RLS-filtered results', async () => {
    expect(await checkSupabase(env, 'healthcheck', 'public', fetchMock([]))).toContain('RLS');
  });
  it('does not silently use service-role keys or assume a table', async () => {
    await expect(checkSupabase({ SUPABASE_SERVICE_ROLE_KEY: 'secret' }, 'healthcheck')).rejects.toThrow('missing');
    await expect(checkSupabase(env, undefined)).rejects.toThrow('table');
    await expect(checkSupabase(env, '../escape')).rejects.toThrow('table');
  });
  it.each([401, 403, 404, 503])('reports HTTP %s without raw error bodies', async status => {
    await expect(checkSupabase(env, 'healthcheck', 'public', fetchMock({ message: 'private-upstream-error' }, status))).rejects.toThrow(`HTTP ${status}`);
  });
  it('rejects a malformed success payload', async () => {
    await expect(checkSupabase(env, 'healthcheck', 'public', fetchMock({ html: true }))).rejects.toThrow('table result');
  });
});
describe('AI runtime requests', () => {
  it.each(Object.keys(providers) as Provider[])('uses the correct %s endpoint and a small token limit', async provider => {
    const config = providers[provider], fetcher = fetchMock({ choices: [{ message: { content: 'OK' } }] });
    const result = await checkAI({ [config.key]: 'fixture-key' }, provider, fetcher);
    expect(fetcher.mock.calls[0]?.[0]).toBe(config.baseURL + '/chat/completions');
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)).max_tokens).toBe(16);
    expect(result).toContain('accepted');
  });
  it('requires explicit provider selection with multiple keys', async () => {
    await expect(checkAI({ OPENAI_API_KEY: 'one', NVIDIA_API_KEY: 'two' })).rejects.toThrow('Multiple');
  });
  it('uses completion-token limits for reasoning models', async () => {
    const fetcher = fetchMock({ choices: [{ message: { content: '' } }] });
    await checkAI({ OPENAI_API_KEY: 'fixture', AI_MODEL: 'gpt-5-mini' }, 'openai', fetcher);
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)).max_completion_tokens).toBe(16);
  });
  it('provides an actionable quota error', async () => {
    await expect(checkAI({ OPENAI_API_KEY: 'fixture' }, 'openai', fetchMock({}, 429))).rejects.toMatchObject({ fix: expect.stringContaining('billing') });
  });
  it('does not leak network error messages', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('leaked-request-key'));
    await expect(checkAI({ OPENAI_API_KEY: 'fixture' }, 'openai', fetcher)).rejects.toThrow('Network request failed');
  });
  it('rejects empty completion payloads', async () => {
    await expect(checkAI({ OPENAI_API_KEY: 'fixture' }, 'openai', fetchMock({}))).rejects.toThrow('no completion');
  });
});
it('reports the first build error only and redacts secrets', () => {
  const output = 'Compiling\n./app/page.tsx:4\nType error: first failure private-value\nnear line 4\n\nError: second failure';
  const excerpt = firstBuildError(output, ['private-value']);
  expect(excerpt).toContain('first failure'); expect(excerpt).not.toContain('second failure'); expect(excerpt).not.toContain('private-value');
});
