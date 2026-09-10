#!/usr/bin/env node
import { Command } from 'commander';
import { realpath } from 'node:fs/promises';
import { initCommand } from './commands/init.js';
import { checkCommand } from './commands/check.js';
import { connectCommand } from './commands/connect.js';
import { doctorCommand } from './commands/doctor.js';
import { readEnv } from './lib/files.js';
import { redact } from './lib/secrets.js';
const program = new Command();
program.name('stackwire').description('Diagnose and fix the connections in a Next.js full-stack project.')
  .version('0.1.0').option('-C, --cwd <directory>', 'Next.js application root', process.cwd())
  .showHelpAfterError().addHelpText('after', '\nExamples:\n  npx stackwire init\n  npx stackwire check --offline\n  npx stackwire -C ./apps/web check --json');
program.command('init').description('Scan the project and save a secret-free integration manifest.')
  .addHelpText('after', '\nExample: npx stackwire -C ./apps/web init')
  .action(async () => initCommand(await realpath(program.opts<{ cwd: string }>().cwd)));
program.command('check').description('Run independent integration diagnostics; critical issues are shown first.')
  .option('--offline', 'skip Vercel network/CLI checks').option('--json', 'print a machine-readable JSON report')
  .option('--strict', 'fail on warnings as well as errors')
  .addHelpText('after', '\nExamples:\n  npx stackwire check\n  npx stackwire check --offline --json\n  npx stackwire check --strict')
  .action(async options => checkCommand(await realpath(program.opts<{ cwd: string }>().cwd), options));
program.command('connect <service>').description('Interactively scaffold supabase, ai, or vercel integrations without silent overwrites.')
  .addHelpText('after', '\nExamples:\n  npx stackwire connect supabase\n  npx stackwire connect ai\n  npx stackwire connect vercel\n\nRequires an interactive terminal. Every replacement has a redacted diff and confirmation.')
  .action(async service => connectCommand(await realpath(program.opts<{ cwd: string }>().cwd), service));
program.command('doctor').description('Run live checks and a production build, streaming progress and stopping at the first failure.')
  .option('-y, --yes', 'authorize live requests and repository build scripts without prompting')
  .option('--table <name>', 'Supabase table for a lightweight read-only SELECT')
  .option('--schema <name>', 'Supabase Data API schema', 'public')
  .option('--provider <name>', 'AI provider: openai, openrouter, or nvidia (required if multiple keys exist)')
  .option('--build-timeout <seconds>', 'maximum build time (1–3600 seconds)', '300')
  .option('--skip-supabase', 'explicitly skip the Supabase query')
  .option('--skip-ai', 'explicitly skip the billable AI request')
  .option('--skip-build', 'explicitly skip npm run build')
  .option('--skip-vercel', 'explicitly skip Vercel env parity')
  .addHelpText('after', '\nExamples:\n  npx stackwire doctor --table profiles\n  npx stackwire doctor --yes --table healthcheck --provider openrouter\n  npx stackwire doctor --yes --skip-ai --skip-supabase\n\nReads .env.local. Queries run with the anon/publishable key and respect RLS. No response data or raw API errors are printed.')
  .action(async options => doctorCommand(await realpath(program.opts<{ cwd: string }>().cwd), options));
try { await program.parseAsync(); }
catch (error) {
  let values: string[] = [];
  try { values = Object.values(await readEnv(program.opts<{ cwd: string }>().cwd)); } catch { /* Preserve original failure. */ }
  console.error(redact(`stackwire: ${error instanceof Error ? error.message : 'Operation failed.'}`, values));
  process.exitCode = 1;
}
