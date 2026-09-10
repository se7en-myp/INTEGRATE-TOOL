import type { Finding, Rule } from '../types.js';
import { clientFiles, pass, warn } from './shared.js';
export const aiRouteSanity: Rule = ({ manifest }) => {
  const sources = manifest.sources.filter(s => s.ai);
  if (!sources.length && !manifest.stack.aiProviders.length) return [warn('ai-route', 'Skipped: no AI integration detected.', 'Run stackwire connect ai when needed.')];
  const findings: Finding[] = [];
  const clients = clientFiles(manifest);
  for (const source of sources) {
    if (clients.has(source.path)) findings.push({ rule: 'ai-route', status: 'FAIL', severity: 'critical', file: source.path,
      message: 'AI SDK or provider endpoint is reachable in the browser.', fix: 'Call a same-origin app/api/.../route.ts handler; keep the provider client server-only.' });
    else if (source.aiRequest && /(?:^|\/)api\//.test(source.path) && !/(?:^|\/)app\/api\/(?:.*\/)?route\.ts$/.test(source.path)) findings.push({ rule: 'ai-route', status: 'FAIL', severity: 'error', file: source.path,
      message: 'AI API code is not in an App Router route.ts handler.', fix: 'Move the API entry point to app/api/<name>/route.ts (or src/app/api/<name>/route.ts).' });
    else if (source.aiRequest && !source.serverOnly && !source.serverAction && !/(?:^|\/)app\/api\/(?:.*\/)?route\.ts$/.test(source.path)) findings.push(warn('ai-route', 'AI helper has no explicit server-only guard.', 'Add import "server-only" to the AI helper.',));
  }
  const map = new Map(manifest.sources.map(s => [s.path, s]));
  const reachesAI = (file: string, seen = new Set<string>()): boolean => {
    if (seen.has(file)) return false; seen.add(file);
    const source = map.get(file);
    return !!source && (source.ai || source.resolvedImports.some(child => reachesAI(child, seen)));
  };
  if (!manifest.sources.some(s => /(?:^|\/)app\/api\/(?:.*\/)?route\.ts$/.test(s.path) && !clients.has(s.path) && reachesAI(s.path))) findings.push(warn('ai-route', 'No server-side App Router AI endpoint detected.', 'Run stackwire connect ai, or verify intentional use of Server Actions.'));
  return findings.length ? findings : [pass('ai-route', 'AI provider calls are behind server-side App Router handlers.')];
};
