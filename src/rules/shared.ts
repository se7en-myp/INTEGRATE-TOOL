import type { Finding, Manifest } from '../types.js';
export const pass = (rule: string, message: string): Finding => ({ rule, status: 'PASS', severity: 'info', message });
export const warn = (rule: string, message: string, fix?: string): Finding => ({ rule, status: 'WARN', severity: 'warning', message, fix });
export function clientFiles(manifest: Manifest): Set<string> {
  const map = new Map(manifest.sources.map(s => [s.path, s]));
  const clients = new Set<string>();
  const visit = (file: string): void => {
    if (clients.has(file)) return;
    const source = map.get(file); if (!source) return;
    // Next.js replaces imports of module-level Server Actions with server references.
    if (source.serverAction && !source.client) return;
    clients.add(file);
    source.resolvedImports.forEach(visit);
  };
  manifest.sources.filter(s => s.client).forEach(s => visit(s.path));
  return clients;
}
