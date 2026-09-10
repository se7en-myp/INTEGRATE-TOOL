import { checkbox, confirm, input, password, select } from '@inquirer/prompts';
import { exists, readEnv } from '../lib/files.js';
import { scan, saveManifest } from '../lib/scan.js';
import { applyPlan, envPlan, offerInstall, type PlannedFile } from '../lib/scaffold.js';
import { providers, isPrivilegedSupabaseKey, validateEndpoint, type Provider } from '../lib/providers.js';
import { browserClient, serverClient, adminClient, sessionRefresh, requestEntry } from '../templates/supabase.js';
import { aiClient, aiRoute } from '../templates/ai.js';
import { environments, inspectVercel, vercelCommand } from '../lib/vercel.js';
import { isSecretKey } from '../lib/secrets.js';
import { run } from '../lib/process.js';
import path from 'node:path';
import type { Environment, Manifest } from '../types.js';
const nonempty = (value: string): true | string => value.trim() && !/[\r\n\0]/.test(value) ? true : 'Enter a nonempty single-line value.';
async function secret(message: string, existing?: string, optional = false): Promise<string> {
  if (existing && await confirm({ message: `${message} is already configured. Keep its hidden value?`, default: true })) return existing;
  return password({ message: `${message}${optional ? ' (optional; Enter to skip)' : ''}`, mask: true, validate: value => optional && !value ? true : nonempty(value) });
}
function appPrefix(manifest: Manifest): string {
  if (!manifest.stack.next || !manifest.stack.appDir) throw new Error('A Next.js App Router project is required. Run in the app directory, not the monorepo root.');
  return manifest.stack.appDir.startsWith('src/') ? 'src/' : '';
}
async function connectSupabase(manifest: Manifest): Promise<void> {
  const root = manifest.root, prefix = appPrefix(manifest), current = await readEnv(root);
  const url = await input({ message: 'Supabase project URL:', default: current.NEXT_PUBLIC_SUPABASE_URL, validate: validateEndpoint });
  const anon = await secret('Supabase anon/publishable key', current.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  if (isPrivilegedSupabaseKey(anon)) throw new Error('A service-role/secret key cannot be used as a public Supabase key. Use an anon or publishable key.');
  const role = await secret('Supabase service-role/secret key (server-only admin use)', current.SUPABASE_SERVICE_ROLE_KEY, true);
  const updates: Record<string, string> = { NEXT_PUBLIC_SUPABASE_URL: url.replace(/\/$/, ''), NEXT_PUBLIC_SUPABASE_ANON_KEY: anon };
  if (role) updates.SUPABASE_SERVICE_ROLE_KEY = role;
  const plan: PlannedFile[] = [...await envPlan(root, updates),
    { path: `${prefix}lib/supabase/client.ts`, content: browserClient },
    { path: `${prefix}lib/supabase/server.ts`, content: serverClient },
    { path: `${prefix}lib/supabase/middleware.ts`, content: sessionRefresh },
  ];
  if (role) plan.push({ path: `${prefix}lib/supabase/admin.ts`, content: adminClient });
  const existing = manifest.files.find(f => /^(?:src\/)?(?:middleware|proxy)\.[jt]s$/.test(f));
  const major = Number(manifest.stack.next?.match(/\d+/)?.[0] ?? 16);
  if (existing && await confirm({ message: `Keep ${existing} and integrate updateSession manually? (Recommended when it contains custom auth/rewrites.)`, default: true })) {
    console.log(`Generated helper will be ${prefix}lib/supabase/middleware.ts. Import updateSession into ${existing}; preserve its returned response/cookies. Existing request pipeline will NOT be modified.`);
  } else {
    if (existing && !existing.endsWith('.ts')) throw new Error('Existing JavaScript middleware needs a manual TypeScript migration. Keep it and integrate the helper instead.');
    const name = existing?.includes('middleware') ? 'middleware' : existing?.includes('proxy') ? 'proxy' : major >= 16 ? 'proxy' : 'middleware';
    const entry = existing ?? `${prefix}${name}.ts`;
    const relative = path.posix.relative(path.posix.dirname(entry), `${prefix}lib/supabase/middleware`);
    plan.push({ path: entry, content: requestEntry(name, relative.startsWith('.') ? relative : './' + relative) });
  }
  if (!await applyPlan(root, plan, [...Object.values(current), ...Object.values(updates)])) return;
  await offerInstall(root, ['@supabase/ssr', '@supabase/supabase-js', 'server-only']);
  await saveManifest(await scan(root));
  console.log('Supabase scaffold ready. Update existing imports to the appropriate new client; enable RLS and verify your session-refresh entry point.');
}
async function connectAI(manifest: Manifest): Promise<void> {
  const root = manifest.root, prefix = appPrefix(manifest), current = await readEnv(root);
  const provider = await select<Provider>({ message: 'AI provider:', choices: Object.entries(providers).map(([value, config]) => ({ value: value as Provider, name: config.label })) });
  const config = providers[provider];
  const key = await secret(`${config.label} API key (server-only)`, current[config.key]);
  const model = await input({ message: 'Model ID (must be available to your account):', default: config.model, validate: nonempty });
  const baseURL = await input({ message: 'OpenAI-compatible base URL (credentials will be sent here):', default: config.baseURL, validate: validateEndpoint });
  const hasSupabase = await exists(path.join(root, `${prefix}lib/supabase/server.ts`));
  const auth = await select<'supabase' | 'token'>({ message: 'Protect the AI endpoint with:', choices: [
    ...(hasSupabase ? [{ name: 'Supabase session (browser UI, authenticated users only)', value: 'supabase' as const }] : []),
    { name: 'Private bearer token (server-to-server only; never embed in browser code)', value: 'token' },
  ] });
  const updates: Record<string, string> = { [config.key]: key, AI_MODEL: model, AI_BASE_URL: baseURL.replace(/\/$/, '') };
  if (auth === 'token') {
    const token = await secret('AI_ROUTE_TOKEN (a separate random secret of at least 32 characters)', current.AI_ROUTE_TOKEN);
    if (token.length < 32 || token === key) throw new Error('Use a distinct AI_ROUTE_TOKEN with at least 32 random characters, not the provider API key.');
    updates.AI_ROUTE_TOKEN = token;
  }
  const plan: PlannedFile[] = [...await envPlan(root, updates),
    { path: `${prefix}lib/ai/client.ts`, content: aiClient(provider) },
    { path: `${prefix}app/api/ai/route.ts`, content: aiRoute(auth) },
  ];
  if (!await applyPlan(root, plan, [...Object.values(current), ...Object.values(updates)])) return;
  await offerInstall(root, ['openai', 'server-only']);
  await saveManifest(await scan(root));
  console.log('AI route ready: POST /api/ai with JSON {"prompt":"..."}. Authentication is required. Add your application-specific quotas and distributed rate limiting before exposing it broadly.');
  if (auth === 'token') console.log('This token-auth route is server-to-server only. For a browser UI, connect Supabase and rerun with session authentication.');
}
async function connectVercel(manifest: Manifest): Promise<void> {
  const root = manifest.root;
  const command = await vercelCommand(root);
  if (!command) throw new Error('Vercel CLI not found. Install with npm install --save-dev vercel, then run vercel login.');
  if (!manifest.stack.vercelLinked) {
    if (!await confirm({ message: 'Run vercel link to select a project? This updates .vercel/project.json.', default: true })) return;
    const result = await run(command, ['link'], root, { inherit: true, timeout: 180_000 });
    if (result.code !== 0) throw new Error('vercel link failed. Run vercel login and verify project access.');
    manifest = await scan(root);
    if (!manifest.stack.vercelLinked) throw new Error('Vercel did not create a valid project link.');
  }
  const state = await inspectVercel(manifest);
  if (state.error || !state.keys) throw new Error(state.error ?? 'Could not inspect Vercel environments.');
  const local = await readEnv(root);
  const selected = await checkbox<Environment>({ message: 'Environments to receive missing local keys (review production secrets carefully):',
    choices: environments.map(value => ({ value, name: value, checked: value === 'development' })), required: true });
  for (const environment of selected) {
    const remote = state.keys[environment];
    if (!remote) throw new Error(`No verified environment list for ${environment}; refusing to upload.`);
    for (const [key, value] of Object.entries(local)) {
      if (remote.includes(key)) continue;
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) { console.log('Skipped an invalid environment variable name.'); continue; }
      if (key.startsWith('NEXT_PUBLIC_') && (isSecretKey(key) || isPrivilegedSupabaseKey(value) || /^(?:sk-|nvapi-)/.test(value))) throw new Error(`${key} exposes a privileged key. Remove its public prefix before uploading.`);
      if (!value.trim()) { console.log(`Skipped empty ${key}.`); continue; }
      if (!await confirm({ message: `Upload ${key} (value hidden) to ${environment}?`, default: false })) continue;
      // Secrets go through stdin, never command arguments, shell history, or logs.
      const result = await run(command, ['env', 'add', key, environment], root, { input: value, timeout: 60_000 });
      if (result.code !== 0) throw new Error(`Upload failed for ${key} (${environment}); verify permissions and Vercel CLI support. Previously uploaded keys are retained.`);
      console.log(`Added ${key} to ${environment}.`);
    }
  }
  await saveManifest(await scan(root));
  console.log('Vercel sync finished. Existing values were not overwritten. Redeploy to apply changes; verify Git repository and production-branch settings in Vercel.');
}
export async function connectCommand(root: string, service: string): Promise<void> {
  if (!['supabase', 'ai', 'vercel'].includes(service)) throw new Error('Unknown service. Choose supabase, ai, or vercel.');
  if (!process.stdin.isTTY) throw new Error('connect requires an interactive terminal; secrets are never accepted as command-line arguments.');
  const manifest = await scan(root);
  if (service === 'supabase') await connectSupabase(manifest);
  else if (service === 'ai') await connectAI(manifest);
  else await connectVercel(manifest);
}
