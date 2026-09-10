import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import type { Manifest } from '../types.js';
import { atomicWrite, exists, posix, readEnv, walk } from './files.js';
import { run } from './process.js';
import { safeRemote, redact } from './secrets.js';
import { isPrivilegedSupabaseKey } from './providers.js';
import { analyzeSource } from './analyze.js';
export async function scan(directory: string): Promise<Manifest> {
  const root = await realpath(directory);
  const warnings: string[] = [];
  async function json(relative: string): Promise<Record<string, unknown> | null> {
    try {
      const parsed: unknown = JSON.parse(await readFile(path.join(root, relative), 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      return parsed as Record<string, unknown>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') warnings.push(`Cannot parse ${relative}; repair its JSON.`);
      return null;
    }
  }
  const pkg = await json('package.json');
  if (!pkg) throw new Error('No readable package.json in this directory. Run stackwire from your Next.js app root.');
  const dependencies = { ...pkg.dependencies as Record<string, string>, ...pkg.devDependencies as Record<string, string> };
  const files = await walk(root);
  const components = await json('components.json');
  const vercel = await json('vercel.json');
  const link = await json('.vercel/project.json');
  const env = await readEnv(root);
  const configPath = path.join(root, 'tsconfig.json');
  let compilerOptions: ts.CompilerOptions = {};
  if (await exists(configPath)) {
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    if (config.error) warnings.push('Cannot parse tsconfig.json.');
    else {
      const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
      compilerOptions = parsed.options;
      if (parsed.errors.some(e => e.code !== 18003)) warnings.push('tsconfig.json has unresolved configuration errors; alias analysis may be incomplete.');
    }
  }
  const sources = [];
  for (const file of files.filter(f => /\.[cm]?[jt]sx?$/.test(f) && !/\.d\.[cm]?ts$/.test(f))) {
    sources.push(analyzeSource(file, await readFile(path.join(root, file), 'utf8')));
  }
  const sourcePaths = new Set(sources.map(s => s.path));
  for (const source of sources) for (const specifier of source.imports) {
    const resolved = ts.resolveModuleName(specifier, path.join(root, source.path), { ...compilerOptions,
      moduleResolution: ts.ModuleResolutionKind.Bundler, allowJs: true }, ts.sys).resolvedModule;
    if (resolved) {
      const relative = posix(path.relative(root, resolved.resolvedFileName));
      if (sourcePaths.has(relative)) source.resolvedImports.push(relative);
    } else if (!/\.(?:css|scss|sass|less|svg|png|jpg|jpeg|webp|json)$/.test(specifier) && (specifier.startsWith('.') || Object.keys(compilerOptions.paths ?? {}).some(alias => specifier.startsWith(alias.replace(/\*.*$/, ''))))) {
      warnings.push(`Unresolved local import in ${source.path}; client dependency analysis may be incomplete.`);
    }
  }
  const remote = await run('git', ['config', '--get', 'remote.origin.url'], root);
  return { version: 1, scannedAt: new Date().toISOString(), root,
    stack: { next: dependencies.next ?? null, appDir: files.some(f => f.startsWith('app/')) ? 'app' : files.some(f => f.startsWith('src/app/')) ? 'src/app' : null,
      typescript: files.includes('tsconfig.json'), shadcn: components !== null,
      supabase: Object.keys(dependencies).some(d => d.startsWith('@supabase/')) || sources.some(s => s.supabase.length > 0),
      aiProviders: Object.keys(dependencies).filter(d => /^(openai|@ai-sdk\/|@openrouter\/)/.test(d)),
      vercelLinked: typeof link?.projectId === 'string' && typeof link.orgId === 'string', vercelConfig: files.includes('vercel.json'),
      gitRemote: remote.code === 0 ? safeRemote(remote.stdout.trim()) : null },
    dependencies, files, sources,
    env: { localKeys: Object.keys(env).sort(),
      unsafePublicKeys: Object.entries(env).filter(([key, value]) => key.startsWith('NEXT_PUBLIC_') && (isPrivilegedSupabaseKey(value) || /^(?:sk-|nvapi-)/.test(value))).map(([key]) => key), emptyKeys: Object.keys(env).filter(key => !env[key]?.trim()).sort(),
      referencedKeys: [...new Set(sources.flatMap(s => s.env.map(e => e.key)))].sort() },
    tsconfig: { paths: compilerOptions.paths ?? {}, baseUrl: posix(path.relative(root, compilerOptions.baseUrl ?? root)) || '.' },
    components, vercel, warnings: [...new Set(warnings)] };
}
export async function saveManifest(manifest: Manifest): Promise<void> {
  // Allowlist config fields. Arbitrary config objects can contain literal credentials.
  const tailwind = manifest.components?.tailwind as Record<string, unknown> | undefined;
  const safe = { ...manifest,
    components: manifest.components ? { aliases: manifest.components.aliases, tailwind: tailwind ? { config: tailwind.config, css: tailwind.css } : undefined } : null,
    vercel: manifest.vercel ? { framework: manifest.vercel.framework, git: manifest.vercel.git } : null };
  const values = Object.values(await readEnv(manifest.root));
  const serialized = JSON.stringify(safe, (_key, value: unknown) => typeof value === 'string' ? redact(value, values) : value, 2);
  await atomicWrite(manifest.root, '.stackwire/manifest.json', serialized + '\n');
}
