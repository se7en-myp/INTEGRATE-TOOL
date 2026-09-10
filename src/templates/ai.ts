import { providers, type Provider } from '../lib/providers.js';
export function aiClient(provider: Provider): string {
  const config = providers[provider];
  return `import 'server-only';
import OpenAI from 'openai';

export function getAIClient(): OpenAI {
  const apiKey = process.env.${config.key};
  if (!apiKey) throw new Error('Missing server-side AI provider configuration.');
  const baseURL = process.env.AI_BASE_URL || ${JSON.stringify(config.baseURL)};
  const endpoint = new URL(baseURL);
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
      (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)))) {
    throw new Error('AI_BASE_URL must use HTTPS, or HTTP on localhost, without credentials.');
  }
  return new OpenAI({ apiKey, baseURL, timeout: 30_000, maxRetries: 1 });
}

export function getAIModel(): string {
  return process.env.AI_MODEL || ${JSON.stringify(config.model)};
}
`;
}
export function aiRoute(auth: 'supabase' | 'token'): string {
  const imports = auth === 'supabase'
    ? `import { createClient } from '../../../lib/supabase/server';`
    : `import { timingSafeEqual } from 'node:crypto';`;
  const authorization = auth === 'supabase' ? `
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return json({ error: 'Authentication required.' }, 401);
    // Only same-origin browser requests may use cookie authentication.
    const origin = request.headers.get('origin');
    if (!origin || origin !== new URL(request.url).origin) return json({ error: 'Invalid request origin.' }, 403);`
    : `
    const expected = process.env.AI_ROUTE_TOKEN;
    if (!expected || expected.length < 32) return json({ error: 'Server authentication is not configured.' }, 503);
    const authorization = request.headers.get('authorization') || '';
    const provided = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    const actualBytes = Buffer.from(provided);
    const expectedBytes = Buffer.from(expected);
    if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) {
      return json({ error: 'Authentication required.' }, 401);
    }`;
  return `import 'server-only';
import OpenAI from 'openai';
import { getAIClient, getAIModel } from '../../../lib/ai/client';
${imports}

export const runtime = 'nodejs';
export const maxDuration = 60;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

// Limit bytes while reading, rather than trusting an optional Content-Length header.
async function readBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Invalid request');
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 16_384) { await reader.cancel(); throw new Error('Invalid request'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

export async function POST(request: Request): Promise<Response> {
  try {${authorization}
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
      return json({ error: 'Content-Type must be application/json.' }, 415);
    }
    let body: unknown;
    try { body = await readBody(request); } catch { return json({ error: 'Invalid JSON or request too large (16 KiB maximum).' }, 400); }
    if (!body || typeof body !== 'object' || !('prompt' in body) || typeof body.prompt !== 'string' ||
        !body.prompt.trim() || body.prompt.length > 4000) {
      return json({ error: 'prompt must contain 1–4000 characters.' }, 400);
    }
    const model = getAIModel();
    const limit = /^(?:o[1-9]|gpt-5)/.test(model) ? { max_completion_tokens: 256 } : { max_tokens: 256 };
    const completion = await getAIClient().chat.completions.create({
      model, messages: [{ role: 'user', content: body.prompt.trim() }], ...limit,
    }, { signal: request.signal });
    const text = completion.choices[0]?.message.content;
    if (typeof text !== 'string') return json({ error: 'Provider returned no text.' }, 502);
    return json({ text });
  } catch (error: unknown) {
    // Do not return SDK error bodies, request headers, or credentials to callers.
    if (error instanceof OpenAI.APIError && error.status === 429) return json({ error: 'AI capacity temporarily exceeded.' }, 429);
    return json({ error: 'AI service unavailable. Check server configuration and provider access.' }, 502);
  }
}
`;
}
