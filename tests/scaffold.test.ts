import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'dotenv';
import { applyPlan, envPlan, envPreview, mergeEnv } from '../src/lib/scaffold.js';
import { exists } from '../src/lib/files.js';
import { isPrivilegedSupabaseKey, validateEndpoint } from '../src/lib/providers.js';
let root: string;
beforeEach(async () => { await mkdir('.cache/tests', { recursive: true }); root = await mkdtemp(path.resolve('.cache/tests/scaffold-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
describe('env editing', () => {
  it('preserves unrelated comments and multiline values, replaces duplicates', () => {
    const before = '# Keep this\nKEEP="first\nsecond"\nKEY=old\nexport KEY=duplicate\n';
    const after = mergeEnv(before, { KEY: 'new#value$with\\slashes', ADDED: 'other' });
    expect(parse(after)).toEqual({ KEEP: 'first\nsecond', KEY: 'new#value$with\\slashes', ADDED: 'other' });
    expect(after).toContain('# Keep this'); expect(after.match(/^KEY=/gm)).toHaveLength(1);
  });
  it('rejects newline injection and hides all values in previews', () => {
    expect(() => mergeEnv('', { KEY: 'value\nEVIL=1' })).toThrow();
    expect(envPreview('KEY=secret\nMULTI="hidden\nvalue"')).toBe('KEY=[REDACTED]\nMULTI=[REDACTED]\n');
  });
  it('adds env and Git ignore changes to the reviewed plan', async () => {
    const plan = await envPlan(root, { KEY: 'hidden' });
    expect(plan.map(f => f.path)).toEqual(['.gitignore', '.env.local']);
    expect(plan[0]?.content).toContain('/.env.local');
    expect(await exists(path.join(root, '.env.local'))).toBe(false);
  });
});
describe('safe write plans', () => {
  it('cancels every write if any replacement is declined', async () => {
    await writeFile(path.join(root, 'existing.ts'), 'original');
    const print = vi.fn();
    const applied = await applyPlan(root, [{ path: 'new.ts', content: 'new' }, { path: 'existing.ts', content: 'changed' }], [], { print, confirm: async () => false });
    expect(applied).toBe(false); expect(await exists(path.join(root, 'new.ts'))).toBe(false);
    expect(await readFile(path.join(root, 'existing.ts'), 'utf8')).toBe('original');
    expect(print.mock.calls.flat().join('\n')).toContain('@@');
  });
  it('redacts diffs, uses 0600 for env files, and requires final approval', async () => {
    await writeFile(path.join(root, '.env.local'), 'KEY=oldsecret');
    const print = vi.fn(), confirm = vi.fn(async () => true);
    expect(await applyPlan(root, [{ path: '.env.local', content: 'KEY=newsecret', sensitive: true }], [], { print, confirm })).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(print.mock.calls.flat().join('\n')).not.toMatch(/oldsecret|newsecret/);
    expect((await stat(path.join(root, '.env.local'))).mode & 0o777).toBe(0o600);
  });
  it('detects edits during review before writing any files', async () => {
    await writeFile(path.join(root, 'a.ts'), 'before');
    const confirm = vi.fn(async () => { await writeFile(path.join(root, 'a.ts'), 'user-edit'); return true; });
    await expect(applyPlan(root, [{ path: 'a.ts', content: 'after' }], [], { print: () => {}, confirm })).rejects.toThrow('changed during review');
    expect(await readFile(path.join(root, 'a.ts'), 'utf8')).toBe('user-edit');
  });
  it('is idempotent for already-generated files', async () => {
    await writeFile(path.join(root, 'a.ts'), 'same');
    const confirm = vi.fn();
    expect(await applyPlan(root, [{ path: 'a.ts', content: 'same' }], [], { print: () => {}, confirm })).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });
});
it('rejects insecure endpoints and privileged browser keys', () => {
  expect(validateEndpoint('https://integrate.api.nvidia.com/v1')).toBe(true);
  expect(validateEndpoint('http://localhost:54321')).toBe(true);
  expect(validateEndpoint('http://example.com')).not.toBe(true);
  expect(validateEndpoint('https://user:secret@example.com')).not.toBe(true);
  expect(isPrivilegedSupabaseKey('sb_secret_not-a-real-key')).toBe(true);
  const jwt = 'header.' + Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url') + '.signature';
  expect(isPrivilegedSupabaseKey(jwt)).toBe(true);
  expect(isPrivilegedSupabaseKey('sb_publishable_not-a-real-key')).toBe(false);
});
