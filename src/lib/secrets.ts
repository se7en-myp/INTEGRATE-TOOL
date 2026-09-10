export function isSecretKey(key: string): boolean {
  return /(?:OPENAI|OPENROUTER|NVIDIA|NIM|AI_PROVIDER|AI_ROUTE).*?(?:KEY|TOKEN)|SUPABASE.*?(?:SERVICE.?ROLE|SECRET)/i.test(key);
}
export function redact(text: string, values: string[] = []): string {
  let result = text;
  for (const value of [...new Set(values)].filter(Boolean).sort((a, b) => b.length - a.length)) {
    result = result.split(value).join('[REDACTED]');
  }
  return result
    .replace(/\b(?:sk-[\w-]+|nvapi-[\w-]+|sb_secret_[\w-]+|gh[pousr]_[\w-]+)\b/g, '[REDACTED]')
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g, '[REDACTED]')
    .replace(/(Bearer\s+)[^\s"']+/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|service[_-]?role[_-]?key|password|token)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, '$1[REDACTED]@');
}
export function safeRemote(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (!['https:', 'http:', 'ssh:', 'git:'].includes(url.protocol)) return null;
    return `${url.protocol}//${url.hostname}${url.pathname}`;
  } catch {
    return /^[\w.-]+@[\w.-]+:[\w./-]+$/.test(raw) ? raw : null;
  }
}
