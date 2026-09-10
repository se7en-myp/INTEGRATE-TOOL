import { providers, validateEndpoint, isPrivilegedSupabaseKey, type Provider } from './providers.js';
import { redact } from './secrets.js';
export class HealthFailure extends Error {
  constructor(message: string, public readonly fix: string) { super(message); this.name = 'HealthFailure'; }
}
export interface HealthStep { name: string; run: () => Promise<string> }
export interface HealthReporter {
  start: (name: string) => void;
  pass: (name: string, detail: string) => void;
  fail: (name: string, error: HealthFailure) => void;
}
export async function runChecklist(steps: HealthStep[], reporter: HealthReporter): Promise<boolean> {
  for (const step of steps) {
    reporter.start(step.name);
    try { reporter.pass(step.name, await step.run()); }
    catch (error) {
      reporter.fail(step.name, error instanceof HealthFailure ? error : new HealthFailure('The check could not complete.', 'Verify network access and configuration, then retry.'));
      return false;
    }
  }
  return true;
}
async function request(url: string, options: RequestInit, fetcher: typeof fetch): Promise<Response> {
  try { return await fetcher(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(30_000) }); }
  catch { throw new HealthFailure('Network request failed or timed out (30 seconds).', 'Verify the service URL, DNS/TLS, network access, and provider availability. Redirects are refused to protect credentials.'); }
}
export async function checkSupabase(env: Record<string, string>, table: string | undefined, schema = 'public', fetcher: typeof fetch = fetch): Promise<string> {
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL;
  // Test the same unprivileged boundary as application users, never silently bypass RLS.
  const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new HealthFailure('Supabase URL or anon/publishable key is missing.', 'Run stackwire connect supabase; doctor reads .env.local.');
  if (isPrivilegedSupabaseKey(key)) throw new HealthFailure('A privileged Supabase key is configured as the anon/publishable key.', 'Replace it with an anon/publishable key and rotate the exposed privileged credential.');
  if (validateEndpoint(url) !== true) throw new HealthFailure('Supabase URL is invalid or insecure.', 'Use an HTTPS project URL, or a localhost HTTP Supabase URL.');
  if (!table || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(table) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) throw new HealthFailure('A valid health-check table/schema is required.', 'Run stackwire doctor --table your_table --schema public (or set SUPABASE_HEALTH_TABLE). Use a table exposed by the Data API.');
  const headers: Record<string, string> = { apikey: key, Accept: 'application/json', 'Accept-Profile': schema };
  // New publishable keys are not JWTs and must not be passed as bearer JWTs.
  if (key.split('.').length === 3) headers.Authorization = `Bearer ${key}`;
  const response = await request(`${url.replace(/\/$/, '')}/rest/v1/${encodeURIComponent(table)}?select=*&limit=1`, { headers }, fetcher);
  if (!response.ok) {
    const fix = response.status === 401 ? 'Verify the anon/publishable key belongs to this Supabase project.' : response.status === 403 ? 'Grant the anon role table access and review RLS policies; do not substitute a service-role key to hide the issue.' : response.status === 404 ? 'Check the table name/schema and expose that schema in the Supabase Data API settings.' : 'Check Supabase project availability and Data API configuration.';
    throw new HealthFailure(`Supabase query failed (HTTP ${response.status}).`, fix);
  }
  let data: unknown;
  try { data = await response.json(); } catch { throw new HealthFailure('Supabase returned an invalid response.', 'Verify the project URL points to the Supabase Data API.'); }
  if (!Array.isArray(data)) throw new HealthFailure('Supabase did not return a table result.', 'Verify the table and REST endpoint.');
  return data.length ? 'Data API SELECT succeeded (row contents not displayed).' : 'Data API SELECT succeeded; empty result. RLS may hide rows; user-specific authorization is not verified.';
}
export async function checkAI(env: Record<string, string>, selected?: Provider, fetcher: typeof fetch = fetch): Promise<string> {
  const detected = (Object.keys(providers) as Provider[]).filter(provider => !!env[providers[provider].key]);
  const provider = selected ?? (detected.length === 1 ? detected[0] : undefined);
  if (!provider) throw new HealthFailure(detected.length ? 'Multiple AI provider keys found.' : 'No AI provider key found.', detected.length ? 'Choose --provider openai, openrouter, or nvidia explicitly.' : 'Run stackwire connect ai to configure a provider.');
  const config = providers[provider], key = env[config.key];
  if (!key) throw new HealthFailure(`${config.key} is missing.`, `Run stackwire connect ai and configure ${config.label}.`);
  const baseURL = env.AI_BASE_URL || (provider === 'openai' ? env.OPENAI_BASE_URL : undefined) || config.baseURL;
  if (validateEndpoint(baseURL) !== true) throw new HealthFailure('AI base URL is invalid or insecure.', 'Use an HTTPS OpenAI-compatible base URL (localhost HTTP is allowed).');
  const model = env.AI_MODEL || config.model;
  const limit = /^(?:o[1-9]|gpt-5)/.test(model) ? { max_completion_tokens: 16 } : { max_tokens: 16 };
  const response = await request(`${baseURL.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply OK.' }], ...limit }),
  }, fetcher);
  if (!response.ok) {
    const fix = [401, 403].includes(response.status) ? 'Verify the API key and account/model access.' : response.status === 429 ? 'Check provider billing, credits, quota, and rate limits.' : [400, 404].includes(response.status) ? 'Verify AI_MODEL and AI_BASE_URL support chat completions and the selected token-limit parameter.' : 'Check provider status and endpoint configuration.';
    throw new HealthFailure(`AI request failed (HTTP ${response.status}).`, fix);
  }
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new HealthFailure('AI provider returned invalid JSON.', 'Verify the OpenAI-compatible endpoint URL.'); }
  const choices = (payload as { choices?: unknown } | null)?.choices;
  if (!Array.isArray(choices) || choices.length === 0 || !choices[0]?.message) throw new HealthFailure('AI provider returned no completion.', 'Verify the model supports the chat completions endpoint.');
  return `${config.label} accepted a minimal completion request (response text hidden).`;
}
export function firstBuildError(output: string, values: string[] = []): string {
  const lines = output.replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/);
  const index = lines.findIndex(line => /(?:Type error:|SyntaxError:|Error:|Module not found|error TS\d+|Build error occurred)/i.test(line));
  const selected = index >= 0 ? lines.slice(Math.max(0, index - 1), index + 3) : lines.filter(Boolean).slice(0, 4);
  // Collapse to a small excerpt; callers never print full captured subprocess output.
  return redact(selected.join('\n').slice(0, 1200), values) || 'Build exited unsuccessfully without diagnostic output.';
}
