export const providers = {
  openai: { label: 'OpenAI', key: 'OPENAI_API_KEY', baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  openrouter: { label: 'OpenRouter', key: 'OPENROUTER_API_KEY', baseURL: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' },
  nvidia: { label: 'NVIDIA', key: 'NVIDIA_API_KEY', baseURL: 'https://integrate.api.nvidia.com/v1', model: 'meta/llama-3.1-8b-instruct' },
} as const;
export type Provider = keyof typeof providers;
export function isProvider(value: string): value is Provider { return Object.hasOwn(providers, value); }
export function validateEndpoint(value: string): true | string {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) return 'Use a URL without embedded credentials, query parameters, or fragments.';
    if (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) return true;
  } catch { /* Report a generic validation error, never the input. */ }
  return 'Use HTTPS (HTTP is allowed only for localhost).';
}
export function isPrivilegedSupabaseKey(value: string): boolean {
  if (value.startsWith('sb_secret_')) return true;
  try { return JSON.parse(Buffer.from(value.split('.')[1] ?? '', 'base64url').toString()).role === 'service_role'; }
  catch { return false; }
}
