import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { scan, saveManifest } from '../src/lib/scan.js';
import { safeTarget } from '../src/lib/files.js';
let root: string;
beforeEach(async () => {
  await mkdir('.cache/tests', { recursive: true }); root = await mkdtemp(path.resolve('.cache/tests/scan-'));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: { next: '^16.0.0' } }));
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
it('scans JSONC aliases, imports and env names, persists no env values', async () => {
  await mkdir(path.join(root, 'src/app'), { recursive: true }); await mkdir(path.join(root, 'src/lib'));
  await writeFile(path.join(root, 'tsconfig.json'), '{ // JSONC\n "compilerOptions": {"paths": {"@/*": ["./src/*"]}}, }');
  await writeFile(path.join(root, 'src/app/page.tsx'), `'use client'; import '@/lib/secret';`);
  await writeFile(path.join(root, 'src/lib/secret.ts'), 'process.env.OPENAI_API_KEY');
  await writeFile(path.join(root, '.env.local'), 'OPENAI_API_KEY="private-not-a-real-value"\nUNUSED=another-private-value\n');
  const m = await scan(root); await saveManifest(m);
  expect(m.sources.find(s => s.path === 'src/app/page.tsx')?.resolvedImports).toEqual(['src/lib/secret.ts']);
  expect(m.env.referencedKeys).toEqual(['OPENAI_API_KEY']);
  expect(m.stack.appDir).toBe('src/app');
  const saved = await readFile(path.join(root, '.stackwire/manifest.json'), 'utf8');
  expect(saved).not.toContain('private-not-a-real-value'); expect(saved).not.toContain('another-private-value');
});
it('excludes generated/vendor trees and skips symlinks', async () => {
  await mkdir(path.join(root, 'node_modules')); await writeFile(path.join(root, 'node_modules/x.ts'), 'process.env.SECRET');
  await symlink(path.join(root, 'node_modules'), path.join(root, 'linked'));
  expect((await scan(root)).sources).toHaveLength(0);
});
it('rejects path traversal and symlink writes', async () => {
  await expect(safeTarget(root, '../escape')).rejects.toThrow();
  await symlink(path.join(root, 'package.json'), path.join(root, 'link.json'));
  await expect(safeTarget(root, 'link.json')).rejects.toThrow();
});
it('does not expose malformed JSON text', async () => {
  await writeFile(path.join(root, 'components.json'), '{"secret": "private-value"');
  const m = await scan(root); expect(m.warnings.join(' ')).not.toContain('private-value');
});
