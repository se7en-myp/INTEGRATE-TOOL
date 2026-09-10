import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parse } from 'dotenv';
const excluded = new Set(['node_modules', '.git', '.next', '.stackwire', '.vercel', 'dist', 'build', 'coverage', '.turbo', '.cache', 'test-fixture', 'examples']);
export const posix = (value: string): string => value.split(path.sep).join('/');
export async function exists(file: string): Promise<boolean> {
  try { await lstat(file); return true; } catch { return false; }
}
export async function walk(root: string, dir = ''): Promise<string[]> {
  const files: string[] = [];
  for (const item of await readdir(path.join(root, dir), { withFileTypes: true })) {
    if (item.isSymbolicLink() || excluded.has(item.name)) continue;
    const relative = posix(path.join(dir, item.name));
    if (item.isDirectory()) files.push(...await walk(root, relative));
    else if (item.isFile()) files.push(relative);
  }
  return files.sort();
}
export async function readEnv(root: string): Promise<Record<string, string>> {
  try { return parse(await readFile(path.join(root, '.env.local'))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error; }
}
// Reject symlinks at every level: a scaffold must never escape the selected project.
export async function safeTarget(root: string, relative: string): Promise<string> {
  const target = path.resolve(root, relative);
  if (target === root || !target.startsWith(path.resolve(root) + path.sep)) throw new Error('Target must be inside the project.');
  const parts = path.relative(root, target).split(path.sep);
  let cursor = root;
  for (const part of parts) {
    cursor = path.join(cursor, part);
    try { if ((await lstat(cursor)).isSymbolicLink()) throw new Error('Refusing to write through a symbolic link.'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return target;
}
export async function atomicWrite(root: string, relative: string, content: string, mode = 0o600): Promise<void> {
  const target = await safeTarget(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { mode, flag: 'wx' });
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}
