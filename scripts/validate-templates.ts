import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { browserClient, serverClient, adminClient, sessionRefresh, requestEntry } from '../src/templates/supabase.js';
import { aiClient, aiRoute } from '../src/templates/ai.js';
import { providers, type Provider } from '../src/lib/providers.js';
import { run } from '../src/lib/process.js';
import { scan } from '../src/lib/scan.js';
import { runRules } from '../src/rules/index.js';
import { exists } from '../src/lib/files.js';
const root = process.cwd();
const modules = path.join(root, 'test-fixture/node_modules');
if (!await exists(path.join(modules, 'openai/package.json'))) throw new Error('Run npm ci --prefix test-fixture first.');
await mkdir(path.join(root, '.cache'), { recursive: true });
const temporary = await mkdtemp(path.join(root, '.cache/generated-'));
try {
  await symlink(modules, path.join(temporary, 'node_modules'), 'dir');
  const files: Record<string, string> = {
    'lib/supabase/client.ts': browserClient, 'lib/supabase/server.ts': serverClient,
    'lib/supabase/admin.ts': adminClient, 'lib/supabase/middleware.ts': sessionRefresh,
    'proxy.ts': requestEntry('proxy'),
    'app/layout.tsx': `import type { ReactNode } from 'react'; export default function Layout({ children }: { children: ReactNode }) { return <html lang="en"><body>{children}</body></html> }`,
    'app/page.tsx': `export default function Page() { return <main>Generated integration validation</main> }`,
  };
  const pkg = JSON.parse(await readFile(path.join(root, 'test-fixture/package.json'), 'utf8'));
  files['package.json'] = JSON.stringify({ ...pkg, name: 'stackwire-generated-validation' });
  files['next.config.ts'] = `import type { NextConfig } from 'next'; const config: NextConfig = { experimental: { cpus: 2 } }; export default config;`;
  files['tsconfig.json'] = JSON.stringify({ compilerOptions: { target: 'ES2022', lib: ['dom', 'dom.iterable', 'esnext'], strict: true, skipLibCheck: true, noEmit: true, esModuleInterop: true, module: 'esnext', moduleResolution: 'bundler', jsx: 'react-jsx', resolveJsonModule: true, isolatedModules: true }, include: ['**/*.ts', '**/*.tsx'], exclude: ['node_modules'] });
  // No credentials are required: clients are initialized at request time, not build time.
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(temporary, file); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, content);
  }
  await mkdir(path.join(temporary, 'lib/ai'), { recursive: true });
  await mkdir(path.join(temporary, 'app/api/ai'), { recursive: true });
  for (const provider of Object.keys(providers) as Provider[]) for (const auth of ['supabase', 'token'] as const) {
    await writeFile(path.join(temporary, 'lib/ai/client.ts'), aiClient(provider));
    await writeFile(path.join(temporary, 'app/api/ai/route.ts'), aiRoute(auth));
    // Compile in a short-lived subprocess so six TypeScript programs do not stay
    // resident while Next.js builds on memory-constrained CI machines.
    const check = await run(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--project', path.join(temporary, 'tsconfig.json')], temporary, { timeout: 60_000 });
    if (check.code !== 0) throw new Error(check.stdout + check.stderr);
    const manifest = await scan(temporary);
    const boundaryFailures = runRules({ manifest }).filter(f => f.status === 'FAIL' && ['secret-leakage', 'ai-route', 'supabase-boundary'].includes(f.rule));
    if (boundaryFailures.length) throw new Error(JSON.stringify(boundaryFailures));
    console.log(`PASS generated ${provider}/${auth}: real SDK typecheck and static boundaries`);
  }
  if (process.argv.includes('--build')) {
    process.env.NEXT_TELEMETRY_DISABLED = '1';
    const build = await run('npm', ['run', 'build'], temporary, { timeout: 180_000 });
    if (build.code !== 0) throw new Error(build.stdout + build.stderr);
    console.log('PASS generated App Router project: real Next.js production build');
  }
} finally { await rm(temporary, { recursive: true, force: true }); }
