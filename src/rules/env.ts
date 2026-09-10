import type { Rule } from '../types.js';
import { pass, warn } from './shared.js';
const runtimeKeys = new Set(['NODE_ENV', 'NEXT_RUNTIME', 'VERCEL', 'VERCEL_ENV', 'VERCEL_URL', 'VERCEL_REGION', 'CI']);
export const envConsistency: Rule = ({ manifest }) => {
  const findings = [];
  const local = new Set(manifest.env.localKeys);
  for (const key of manifest.env.referencedKeys) if (!runtimeKeys.has(key) && (!local.has(key) || manifest.env.emptyKeys.includes(key))) {
    findings.push({ rule: 'env-consistency', status: 'FAIL' as const, severity: 'error' as const,
      message: `${key} is referenced but ${local.has(key) ? 'empty' : 'missing'} in .env.local.`, fix: `Set ${key} in .env.local and in the deployment environment.` });
  }
  for (const key of local) if (!manifest.env.referencedKeys.includes(key)) findings.push(warn('env-consistency', `${key} has no static references.`, 'Remove it if unused; dynamic reads or external tools may still need it.'));
  if (manifest.sources.some(s => s.dynamicEnv)) findings.push(warn('env-consistency', 'Dynamic process.env access cannot be fully resolved.', 'Use explicit process.env.KEY references for auditable configuration.'));
  return findings.length ? findings : [pass('env-consistency', 'Static env references match .env.local (framework-provided keys excluded).')];
};
