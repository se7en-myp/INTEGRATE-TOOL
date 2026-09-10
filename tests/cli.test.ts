import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { run } from '../src/lib/process.js';
let root: string;
const project = process.cwd();
const cli = (args: string[]) => run(process.execPath, ['--import', 'tsx', 'src/cli.ts', '-C', root, ...args], project, { timeout: 20_000 });
beforeEach(async () => {
  await mkdir('.cache/tests', { recursive: true }); root = await mkdtemp(path.resolve('.cache/tests/cli-'));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: { next: '^16.0.0' }, scripts: { build: 'node -e "process.exit(0)"' } }));
  await mkdir(path.join(root, 'app'));
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
it('runs init then returns sorted JSON findings and failure exit code', async () => {
  await writeFile(path.join(root, 'app/page.tsx'), `'use client'; process.env.OPENAI_API_KEY`);
  await writeFile(path.join(root, '.env.local'), 'OPENAI_API_KEY=private-fixture-value');
  expect((await cli(['init'])).code).toBe(0);
  const cached = await readFile(path.join(root, '.stackwire/manifest.json'), 'utf8');
  expect(cached).not.toContain('private-fixture-value');
  const report = await cli(['check', '--offline', '--json']);
  expect(report.code).toBe(1); expect(JSON.parse(report.stdout).findings[0].severity).toBe('critical');
  expect(report.stdout).not.toContain('private-fixture-value');
}, 30_000);
it('refreshes stale manifests and supports strict warning exit codes', async () => {
  await writeFile(path.join(root, 'app/page.tsx'), 'export default function Page() { return null; }');
  expect((await cli(['check', '--offline', '--json'])).code).toBe(0);
  expect((await cli(['check', '--offline', '--strict', '--json'])).code).toBe(1);
  await writeFile(path.join(root, 'app/page.tsx'), 'process.env.NEW_KEY');
  const report = await cli(['check', '--offline', '--json']);
  expect(report.code).toBe(1); expect(report.stdout).toContain('NEW_KEY');
}, 30_000);
it('requires interactive connect and explicit runtime authorization', async () => {
  expect((await cli(['connect', 'ai'])).stderr).toContain('interactive terminal');
  expect((await cli(['doctor'])).stderr).toContain('--yes');
  const doctor = await cli(['doctor', '--yes']);
  expect(doctor.code).toBe(0); expect(doctor.stdout).toContain('PASS Production build');
}, 30_000);
it('doctor stops before build when Supabase is misconfigured', async () => {
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: { '@supabase/ssr': '^0.7.0' }, scripts: { build: 'node -e "process.exit(99)"' } }));
  const doctor = await cli(['doctor', '--yes', '--table', 'healthcheck']);
  expect(doctor.code).toBe(1); expect(doctor.stderr).toContain('FAIL Supabase');
  expect(doctor.stdout).not.toContain('CHECK Production build');
}, 30_000);
