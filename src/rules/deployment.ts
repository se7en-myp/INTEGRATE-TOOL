import type { Finding, Rule } from '../types.js';
import { pass, warn } from './shared.js';
export const deploymentWiring: Rule = ({ manifest }) => {
  const findings: Finding[] = [];
  if (!manifest.stack.gitRemote) findings.push(warn('deployment-wiring', 'No recognizable origin remote found.', 'Add your GitHub repository as git remote origin.'));
  else if (!manifest.stack.gitRemote.includes('github.com')) findings.push(warn('deployment-wiring', 'Origin is not a GitHub remote.', 'Verify that your Git provider repository is connected in Vercel project settings.'));
  const git = manifest.vercel?.git as Record<string, unknown> | undefined;
  if (git?.deploymentEnabled === false) findings.push({ rule: 'deployment-wiring', status: 'FAIL', severity: 'error', message: 'vercel.json disables Git deployments.', fix: 'Enable git.deploymentEnabled for the intended production/preview branches.' });
  if (git?.deploymentEnabled && typeof git.deploymentEnabled === 'object' && Object.values(git.deploymentEnabled).includes(false)) findings.push(warn('deployment-wiring', 'Git deployment is disabled for one or more branches.', 'Review git.deploymentEnabled branch patterns.'));
  if (manifest.vercel?.framework && manifest.vercel.framework !== 'nextjs') findings.push({ rule: 'deployment-wiring', status: 'FAIL', severity: 'error', message: 'vercel.json selects a framework other than Next.js.', fix: 'Set framework to nextjs or remove the override.' });
  return findings.length ? findings : [pass('deployment-wiring', 'Local Git/Vercel configuration has no obvious conflicts; remote webhook/build settings are not verified.')];
};
