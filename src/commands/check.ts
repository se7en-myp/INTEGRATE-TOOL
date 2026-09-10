import ora from 'ora';
import { scan, saveManifest } from '../lib/scan.js';
import { inspectVercel } from '../lib/vercel.js';
import { runRules } from '../rules/index.js';
import { printReport } from '../lib/report.js';
export async function checkCommand(root: string, options: { offline?: boolean; json?: boolean; strict?: boolean }): Promise<void> {
  const spinner = options.json ? null : ora('Scanning integration boundaries…').start();
  try {
    const manifest = await scan(root);
    await saveManifest(manifest);
    const vercel = options.offline ? undefined : await inspectVercel(manifest);
    const findings = runRules({ manifest, vercel });
    spinner?.stop();
    if (options.json) console.log(JSON.stringify({ version: 1, findings }, null, 2)); else printReport(findings);
    if (findings.some(f => f.status === 'FAIL' || (options.strict && f.status === 'WARN'))) process.exitCode = 1;
  } finally { spinner?.stop(); }
}
