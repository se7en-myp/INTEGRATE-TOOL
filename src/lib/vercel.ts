import path from 'node:path';
import { exists } from './files.js';
import { run } from './process.js';
import type { Environment, Manifest, VercelState } from '../types.js';
export const environments: Environment[] = ['development', 'preview', 'production'];
export async function vercelCommand(root: string): Promise<string | null> {
  const local = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'vercel.cmd' : 'vercel');
  if (await exists(local)) return local;
  return (await run('vercel', ['--version'], root)).code === 0 ? 'vercel' : null;
}
export function parseVercelEnv(output: string): string[] {
  const clean = output.replace(/\x1b\[[0-9;]*m/g, '');
  if (/No Environment Variables found/i.test(clean)) return [];
  const keys = [...clean.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s+(?:Encrypted|Plain\s*Text|Sensitive|Secret|Config)\b/gmi)].map(m => m[1]!);
  if (!keys.length) throw new Error('Unrecognized Vercel env output; update the Vercel CLI and retry.');
  return [...new Set(keys)].sort();
}
export async function inspectVercel(manifest: Manifest): Promise<VercelState> {
  const state: VercelState = { linked: manifest.stack.vercelLinked, available: false };
  if (!state.linked) return state;
  const command = await vercelCommand(manifest.root);
  if (!command) return state;
  state.available = true;
  state.keys = {};
  for (const environment of environments) {
    const result = await run(command, ['env', 'ls', environment], manifest.root);
    if (result.code !== 0) { state.error = `Cannot list ${environment} variables${result.timedOut ? ' (timed out)' : ''}. Run vercel login and verify project access.`; break; }
    try { state.keys[environment] = parseVercelEnv(result.stdout + '\n' + result.stderr); }
    catch (error) { state.error = (error as Error).message; break; }
  }
  return state;
}
