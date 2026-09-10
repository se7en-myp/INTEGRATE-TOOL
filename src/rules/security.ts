import type { Finding, Rule } from '../types.js';
import { isSecretKey } from '../lib/secrets.js';
import { clientFiles, pass } from './shared.js';
export const secretLeakage: Rule = ({ manifest }) => {
  const findings: Finding[] = [];
  const clients = clientFiles(manifest);
  const critical = (message: string, file?: string, line?: number): void => { findings.push({ rule: 'secret-leakage', status: 'FAIL', severity: 'critical', message, file, line,
    fix: 'Move privileged access to a server-only module/Route Handler; rotate any key that was committed or shipped to browsers.' }); };
  for (const key of new Set([...manifest.env.localKeys, ...manifest.env.referencedKeys])) if (key.startsWith('NEXT_PUBLIC_') && isSecretKey(key)) critical(`${key} is a privileged key with a public prefix.`);
  for (const key of manifest.env.unsafePublicKeys ?? []) critical(`${key} contains a privileged credential despite its public name.`);
  for (const source of manifest.sources) {
    if (clients.has(source.path) && source.serverOnly) critical('Client import graph reaches a server-only module.', source.path);
    for (const reference of source.env.filter(e => isSecretKey(e.key))) {
      if (clients.has(source.path)) critical(`${reference.key} is read in the client dependency graph.`, source.path, reference.line);
      else if (/(?:^|\/)app\/(?:.*\/)?page\.[jt]sx?$/.test(source.path) && !source.serverOnly && !source.serverAction) critical(`${reference.key} is read in a page without an explicit server-only guard.`, source.path, reference.line);
    }
    for (const line of source.hardcodedSecretLines) critical('Possible hardcoded credential detected (value redacted).', source.path, line);
  }
  return findings.length ? findings : [pass('secret-leakage', 'No privileged key exposure detected in static source/import analysis.')];
};
