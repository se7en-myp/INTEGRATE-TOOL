import type { Finding, Rule, RuleContext } from '../types.js';
import { secretLeakage } from './security.js';
import { supabaseBoundary } from './supabase.js';
import { envConsistency } from './env.js';
import { vercelParity } from './vercel.js';
import { shadcnSanity } from './shadcn.js';
import { aiRouteSanity } from './ai.js';
import { deploymentWiring } from './deployment.js';
export const rules: Rule[] = [secretLeakage, supabaseBoundary, envConsistency, vercelParity, shadcnSanity, aiRouteSanity, deploymentWiring];
export function runRules(context: RuleContext): Finding[] {
  const findings = rules.flatMap(rule => rule(context));
  for (const warning of context.manifest.warnings) findings.push({ rule: 'scanner', status: 'WARN', severity: 'warning', message: warning });
  const rank = { critical: 0, error: 1, warning: 2, info: 3 };
  return findings.sort((a, b) => rank[a.severity] - rank[b.severity] || a.rule.localeCompare(b.rule));
}
