import { confirm } from '@inquirer/prompts';
import { createTwoFilesPatch } from 'diff';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'dotenv';
import { atomicWrite, exists, safeTarget } from './files.js';
import { redact } from './secrets.js';
import { run } from './process.js';
export interface PlannedFile { path: string; content: string; sensitive?: boolean }
export interface ScaffoldIO {
  confirm: (message: string) => Promise<boolean>;
  print: (message: string) => void;
}
const defaultIO: ScaffoldIO = { confirm: message => confirm({ message, default: false }), print: message => console.log(message) };
export function mergeEnv(original: string, updates: Record<string, string>): string {
  const remaining = new Map(Object.entries(updates));
  const rendered = (key: string, value: string): string => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || /[\r\n\0]/.test(value)) throw new Error('Env keys and values must be single-line.');
    // Single quotes preserve backslashes, # and $ literally in dotenv.
    if (!value.includes("'")) return `${key}='${value}'`;
    if (!value.includes('"') && !/\\[nr]/.test(value)) return `${key}="${value}"`;
    throw new Error('This value cannot be safely represented in dotenv; edit .env.local manually.');
  };
  const text = original.replace(/^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*(?:'[^']*'|"(?:\\.|[^"\\])*"|`[^`]*`|[^\r\n]*)[^\S\r\n]*(?:#[^\r\n]*)?/gm, (match, key: string) => {
    if (!Object.hasOwn(updates, key)) return match;
    const value = updates[key]!;
    if (!remaining.has(key)) return ''; // Remove duplicate assignments for updated keys.
    remaining.delete(key); return rendered(key, value);
  });
  return text.replace(/\s*$/, '') + '\n' + [...remaining].map(([key, value]) => rendered(key, value)).join('\n') + (remaining.size ? '\n' : '');
}
export function envPreview(text: string): string {
  return Object.keys(parse(text)).sort().map(key => `${key}=[REDACTED]`).join('\n') + '\n';
}
export async function applyPlan(root: string, files: PlannedFile[], secretValues: string[], io = defaultIO): Promise<boolean> {
  const pending: Array<PlannedFile & { before: string | null; mode: number }> = [];
  // Review and approve the entire plan before writing anything.
  for (const file of files) {
    const target = await safeTarget(root, file.path);
    const before = await exists(target) ? await readFile(target, 'utf8') : null;
    if (before === file.content) { io.print(`Unchanged ${file.path}`); continue; }
    const mode = file.sensitive ? 0o600 : before !== null ? (await stat(target)).mode & 0o777 : 0o644;
    if (before !== null) {
      const oldText = file.sensitive ? envPreview(before) : redact(before, secretValues);
      const newText = file.sensitive ? envPreview(file.content) : redact(file.content, secretValues);
      io.print(createTwoFilesPatch(`a/${file.path}`, `b/${file.path}`, oldText, newText));
      if (file.sensitive) io.print('All env values are hidden. Existing values for the selected service may change even if this redacted diff is empty.');
      if (/(?:^|\/)(?:middleware|proxy)\.ts$/.test(file.path)) io.print('WARNING: replacement removes the existing request/auth/rewrite logic. Decline to keep it and integrate session refresh manually.');
      if (!await io.confirm(`Replace ${file.path}?`)) { io.print('Cancelled; no files changed.'); return false; }
    } else io.print(`Create ${file.path}${file.sensitive ? ' (values hidden)' : ''}`);
    pending.push({ ...file, before, mode });
  }
  if (!pending.length) return true;
  if (!await io.confirm(`Apply ${pending.length} reviewed file changes?`)) return false;
  // Recheck snapshots to avoid overwriting edits made while the wizard was open.
  for (const file of pending) {
    const target = await safeTarget(root, file.path);
    const now = await exists(target) ? await readFile(target, 'utf8') : null;
    if (now !== file.before) throw new Error(`${file.path} changed during review. No files were written; rerun the wizard.`);
  }
  for (const file of pending) { await atomicWrite(root, file.path, file.content, file.mode); io.print(`Wrote ${file.path}`); }
  return true;
}
export async function envPlan(root: string, updates: Record<string, string>): Promise<PlannedFile[]> {
  const tracked = await run('git', ['ls-files', '--error-unmatch', '.env.local'], root);
  if (tracked.code === 0) throw new Error('.env.local is tracked by Git. Untrack it and rotate exposed secrets before continuing.');
  const envPath = await safeTarget(root, '.env.local');
  const current = await exists(envPath) ? await readFile(envPath, 'utf8') : '';
  const ignorePath = await safeTarget(root, '.gitignore');
  const ignore = await exists(ignorePath) ? await readFile(ignorePath, 'utf8') : '';
  const required = ['/.env.local', '/.env.*.local', '/.stackwire/', '/.vercel/'];
  const missing = required.filter(line => !ignore.split(/\r?\n/).includes(line));
  const plan: PlannedFile[] = [{ path: '.env.local', content: mergeEnv(current, updates), sensitive: true }];
  if (missing.length) plan.unshift({ path: '.gitignore', content: ignore.replace(/\s*$/, '') + '\n' + missing.join('\n') + '\n' });
  return plan;
}
export async function offerInstall(root: string, packages: string[]): Promise<void> {
  console.log(`Required dependencies: ${packages.join(' ')}`);
  if (await exists(path.join(root, 'pnpm-lock.yaml')) || await exists(path.join(root, 'yarn.lock')) || await exists(path.join(root, 'bun.lock'))) {
    console.log('Use your existing package manager to add these dependencies. No lockfile was changed.'); return;
  }
  if (!await confirm({ message: `Run npm install ${packages.join(' ')}? This updates package.json/lockfile and may execute dependency lifecycle scripts.`, default: false })) {
    console.log(`Install manually: npm install ${packages.join(' ')}`); return;
  }
  const result = await run('npm', ['install', ...packages], root, { timeout: 180_000 });
  if (result.code !== 0) throw new Error('Dependency installation failed. Files were generated; run npm install manually to inspect and resolve the failure.');
  console.log('Dependencies installed.');
}
