import { confirm, input } from '@inquirer/prompts';
import ora from 'ora';
import chalk from 'chalk';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { readEnv } from '../lib/files.js';
import { scan, saveManifest } from '../lib/scan.js';
import { run } from '../lib/process.js';
import { inspectVercel } from '../lib/vercel.js';
import { vercelParity } from '../rules/vercel.js';
import { secretLeakage } from '../rules/security.js';
import { isProvider } from '../lib/providers.js';
import { checkAI, checkSupabase, firstBuildError, HealthFailure, runChecklist, type HealthStep } from '../lib/health.js';
import { redact } from '../lib/secrets.js';
export interface DoctorOptions {
  yes?: boolean; table?: string; schema?: string; provider?: string;
  skipSupabase?: boolean; skipAi?: boolean; skipBuild?: boolean; skipVercel?: boolean; buildTimeout?: string;
}
export async function doctorCommand(root: string, options: DoctorOptions): Promise<void> {
  if (options.provider && !isProvider(options.provider)) throw new Error('Invalid provider. Use openai, openrouter, or nvidia.');
  const timeout = Number(options.buildTimeout ?? 300);
  if (!Number.isFinite(timeout) || timeout < 1 || timeout > 3600) throw new Error('--build-timeout must be between 1 and 3600 seconds.');
  const manifest = await scan(root), env = await readEnv(root);
  await saveManifest(manifest);
  const redactValues = [...Object.values(env), ...Object.entries(process.env).filter(([key]) => /key|token|secret|password/i.test(key)).map(([, value]) => value ?? '')];
  // Prevent running builds that would bundle known secrets before making network calls.
  const critical = secretLeakage({ manifest }).find(finding => finding.status === 'FAIL');
  if (critical) { console.error(`FAIL Security preflight: ${critical.message}\nFix: ${critical.fix}`); process.exitCode = 1; return; }
  console.log('Doctor makes live service requests (AI may incur a small charge) and runs the repository\'s npm build script. Only run this in a trusted project.');
  if (!options.yes) {
    if (!process.stdin.isTTY) throw new Error('Use --yes to authorize runtime requests/build in a non-interactive terminal.');
    if (!await confirm({ message: 'Run the selected runtime checks?', default: false })) return;
  }
  let table = options.table ?? env.SUPABASE_HEALTH_TABLE;
  if (manifest.stack.supabase && !options.skipSupabase && !table && process.stdin.isTTY) table = await input({ message: 'Supabase table for a read-only health query:', validate: value => /^[A-Za-z_][A-Za-z0-9_]*$/.test(value) || 'Enter a table identifier.' });
  const steps: HealthStep[] = [];
  const skips: string[] = [];
  if (options.skipSupabase || !manifest.stack.supabase) skips.push('Supabase');
  else steps.push({ name: 'Supabase', run: () => checkSupabase(env, table, options.schema ?? 'public') });
  const hasAI = manifest.stack.aiProviders.length > 0 || manifest.sources.some(s => s.ai) || Object.keys(env).some(key => /^(OPENAI|OPENROUTER|NVIDIA)_API_KEY$/.test(key));
  if (options.skipAi || !hasAI) skips.push('AI provider');
  else steps.push({ name: 'AI provider', run: () => checkAI(env, options.provider && isProvider(options.provider) ? options.provider : undefined) });
  if (options.skipBuild) skips.push('Production build');
  else steps.push({ name: 'Production build', run: async () => {
    const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
    if (!pkg.scripts?.build) throw new HealthFailure('package.json has no build script.', 'Add a build script running next build.');
    const result = await run('npm', ['run', 'build'], root, { timeout: timeout * 1000 });
    if (result.timedOut) throw new HealthFailure(`Build timed out after ${timeout} seconds.`, 'Inspect hanging build-time network calls, or increase --build-timeout.');
    if (result.code !== 0) throw new HealthFailure(firstBuildError(result.stdout + '\n' + result.stderr, redactValues), 'Fix this first build error, then rerun stackwire doctor. Use npm run build for the complete local log.');
    return 'npm run build completed successfully.';
  } });
  if (options.skipVercel || !manifest.stack.vercelLinked) skips.push('Vercel env parity');
  else steps.push({ name: 'Vercel env parity', run: async () => {
    const state = await inspectVercel(manifest);
    if (!state.available) throw new HealthFailure('Project is linked, but Vercel CLI is unavailable.', 'Install the Vercel CLI and run vercel login.');
    const findings = vercelParity({ manifest, vercel: state });
    const problem = findings.find(finding => finding.status !== 'PASS');
    if (problem) throw new HealthFailure(problem.message, problem.fix ?? 'Review Vercel environment configuration.');
    return 'Env names match all three Vercel environments; values and branch overrides are not compared.';
  } });
  for (const name of skips) console.log(chalk.yellow(`SKIP ${name} (not detected or explicitly skipped).`));
  let spinner: ReturnType<typeof ora> | undefined;
  const success = await runChecklist(steps, {
    start: name => { console.log(`CHECK ${name}`); spinner = ora(`Checking ${name}…`).start(); },
    pass: (name, detail) => { spinner?.stop(); console.log(chalk.green(`PASS ${name}: ${redact(detail, redactValues)}`)); },
    fail: (name, error) => { spinner?.stop(); console.error(chalk.red(`FAIL ${name}: ${redact(error.message, redactValues)}`)); console.error(`Fix: ${redact(error.fix, redactValues)}\nStopped at the first failure. Fix it and rerun doctor.`); },
  });
  if (!success) process.exitCode = 1;
  else console.log(steps.length ? `Doctor finished: ${steps.length} checks passed, ${skips.length} skipped. This does not verify UI flows or deployed webhooks.` : 'No checks ran; all services were skipped.');
}
