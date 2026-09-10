import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { analyzeSource } from '../src/lib/analyze.js';
import { scan, saveManifest } from '../src/lib/scan.js';
import { secretLeakage } from '../src/rules/security.js';
import { supabaseBoundary } from '../src/rules/supabase.js';
import { requestEntry } from '../src/templates/supabase.js';
import { checkSupabase } from '../src/lib/health.js';
import { manifest } from './helpers.js';
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
it('ignores inline type-only imports but not mixed value imports', () => {
  expect(analyzeSource('a.ts', `import { type Secret } from './server';`).imports).toEqual([]);
  expect(analyzeSource('a.ts', `import { type Secret, getSecret } from './server';`).imports).toEqual(['./server']);
});
it('handles namespace Supabase factories and bracketed env objects', () => {
  const source = analyzeSource('a.ts', `import * as ssr from '@supabase/ssr'; ssr.createServerClient(url,key); process['env']['OPENAI_API_KEY'];`);
  expect(source.supabase).toEqual(['server']); expect(source.env[0]?.key).toBe('OPENAI_API_KEY');
});
it('flags privileged JWT literals and AI route bearer tokens in clients', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from('{"role":"service_role"}').toString('base64url') + '.fake-signature';
  expect(analyzeSource('a.ts', `const key = '${jwt}'`).hardcodedSecretLines).toEqual([1]);
  expect(secretLeakage({ manifest: manifest({ 'a.ts': `'use client'; process.env.AI_ROUTE_TOKEN` }) })[0]?.severity).toBe('critical');
});
it('records only names when public env values contain privileged credentials', async () => {
  await mkdir('.cache/tests', { recursive: true }); const root = await mkdtemp(path.resolve('.cache/tests/regression-')); roots.push(root);
  await writeFile(path.join(root, 'package.json'), '{}');
  await writeFile(path.join(root, '.env.local'), 'NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_secret_fixture-privileged');
  const m = await scan(root); await saveManifest(m);
  expect(m.env.unsafePublicKeys).toEqual(['NEXT_PUBLIC_SUPABASE_ANON_KEY']);
  expect(secretLeakage({ manifest: m })[0]?.severity).toBe('critical');
  expect(await readFile(path.join(root, '.stackwire/manifest.json'), 'utf8')).not.toContain('sb_secret_fixture-privileged');
});
it('refuses a privileged key in doctor even if placed under an anon key name', async () => {
  await expect(checkSupabase({ NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_secret_fake' }, 'health')).rejects.toThrow('privileged');
});
it('supports root request entry with src-based libraries', () => {
  expect(requestEntry('proxy', './src/lib/supabase/middleware')).toContain('from "./src/lib/supabase/middleware"');
});

it('does not mistake a Supabase middleware helper for a Next.js request entry point', () => {
  const m = manifest({
    'lib/supabase/client.ts': "import { createBrowserClient } from '@supabase/ssr'; createBrowserClient(url,key);",
    'lib/supabase/server.ts': "import { createServerClient } from '@supabase/ssr'; createServerClient(url,key);",
    'lib/supabase/middleware.ts': "import { createServerClient } from '@supabase/ssr'; createServerClient(url,key);",
  });
  m.stack.supabase = true;
  expect(supabaseBoundary({ manifest: m }).some(f => f.status === 'WARN' && f.message.includes('entry point'))).toBe(true);
  m.files.push('src/proxy.ts');
  expect(supabaseBoundary({ manifest: m })[0]?.status).toBe('PASS');
  m.sources = m.sources.filter(s => s.path !== 'lib/supabase/server.ts');
  expect(supabaseBoundary({ manifest: m })[0]?.status).toBe('FAIL');
});
