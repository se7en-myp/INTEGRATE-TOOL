import type { Finding, Rule } from '../types.js';
import { environments } from '../lib/vercel.js';
import { pass, warn } from './shared.js';
export const vercelParity: Rule = ({ manifest, vercel }) => {
  if (!manifest.stack.vercelLinked) return [warn('vercel-env', 'Skipped: project is not linked to Vercel.', 'Run stackwire connect vercel.')];
  if (!vercel?.available) return [warn('vercel-env', 'Skipped: Vercel CLI is unavailable or remote checks were disabled.', 'Install the Vercel CLI and rerun without --offline.')];
  if (vercel.error) return [{ rule: 'vercel-env', status: 'FAIL', severity: 'error', message: vercel.error, fix: 'Run vercel login, verify the project link, and retry.' }];
  const findings: Finding[] = [];
  for (const environment of environments) {
    const remote = vercel.keys?.[environment];
    if (!remote) { findings.push(warn('vercel-env', `${environment}: environment list was not available.`)); continue; }
    for (const key of manifest.env.localKeys) if (!remote.includes(key)) findings.push({ rule: 'vercel-env', status: 'FAIL', severity: 'error',
      message: `${key} is missing on Vercel (${environment}).`, fix: `Run stackwire connect vercel and select ${environment}; redeploy afterward.` });
    for (const key of remote) if (!manifest.env.localKeys.includes(key)) findings.push(warn('vercel-env', `${key} exists only on Vercel (${environment}).`, 'Check whether this environment-specific variable also belongs in .env.local.'));
  }
  return findings.length ? findings : [pass('vercel-env', 'Env names match development, preview, and production (values not compared).')];
};
