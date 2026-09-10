import type { Finding, Rule } from '../types.js';
import { clientFiles, pass, warn } from './shared.js';
export const supabaseBoundary: Rule = ({ manifest }) => {
  if (!manifest.stack.supabase) return [warn('supabase-boundary', 'Skipped: Supabase is not detected.', 'Run stackwire connect supabase when needed.')];
  const findings: Finding[] = [];
  const sources = manifest.sources.filter(s => s.supabase.length);
  const browser = sources.filter(s => s.supabase.includes('browser'));
  const server = sources.filter(s => s.supabase.includes('server') && !/(?:^|\/)(?:middleware|proxy)\.[jt]sx?$/.test(s.path));
  if (!browser.length || !server.length || !browser.some(b => server.some(s => s.path !== b.path))) findings.push({ rule: 'supabase-boundary', status: 'FAIL', severity: 'error',
    message: 'Separate browser and cookie-aware server Supabase clients were not found.', fix: 'Run stackwire connect supabase to generate @supabase/ssr clients.' });
  const clients = clientFiles(manifest);
  for (const source of sources) if (source.supabase.includes('server') && clients.has(source.path)) findings.push({ rule: 'supabase-boundary', status: 'FAIL', severity: 'error',
    message: 'A server Supabase factory is reachable from a Client Component.', file: source.path, fix: 'Import the browser client from Client Components, not the server client.' });
  for (const source of sources.filter(s => s.supabase.includes('shared'))) {
    const importers = manifest.sources.filter(s => s.resolvedImports.includes(source.path));
    if (importers.some(s => clients.has(s.path)) && importers.some(s => !clients.has(s.path))) findings.push({ rule: 'supabase-boundary', status: 'FAIL', severity: 'error',
      message: 'One plain Supabase client is shared by client and server modules.', file: source.path, fix: 'Split into createBrowserClient and cookie-aware createServerClient modules.' });
  }
  if (server.length && !manifest.files.some(f => /^(?:src\/)?(?:middleware|proxy)\.[jt]s$/.test(f))) findings.push(warn('supabase-boundary', 'No middleware/proxy session-refresh entry point found.', 'Run stackwire connect supabase or wire session refresh into your existing request pipeline.'));
  return findings.length ? findings : [pass('supabase-boundary', 'Separate Supabase browser and server client factories detected.')];
};
