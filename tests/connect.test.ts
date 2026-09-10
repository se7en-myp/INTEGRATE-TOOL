import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'dotenv';
const answers = vi.hoisted(() => ({ input: [] as string[], password: [] as string[], select: [] as string[] }));
vi.mock('@inquirer/prompts', () => ({
  input: vi.fn(async () => answers.input.shift()), password: vi.fn(async () => answers.password.shift()),
  select: vi.fn(async () => answers.select.shift()), checkbox: vi.fn(async () => []),
  confirm: vi.fn(async ({ message }: { message: string }) => !message.startsWith('Run npm install')),
}));
import { connectCommand } from '../src/commands/connect.js';
let root: string;
let originalTTY: PropertyDescriptor | undefined;
beforeEach(async () => {
  await mkdir('.cache/tests', { recursive: true }); root = await mkdtemp(path.resolve('.cache/tests/connect-'));
  await mkdir(path.join(root, 'src/app'), { recursive: true });
  await writeFile(path.join(root, 'src/app/page.tsx'), 'export default function Page() { return null; }');
  await writeFile(path.join(root, 'package.json'), '{"dependencies":{"next":"^16.0.0"}}');
  originalTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(async () => {
  if (originalTTY) Object.defineProperty(process.stdin, 'isTTY', originalTTY);
  else Reflect.deleteProperty(process.stdin, 'isTTY');
  vi.restoreAllMocks(); answers.input.length = 0; answers.password.length = 0; answers.select.length = 0;
  await rm(root, { recursive: true, force: true });
});
it('runs Supabase then AI wizards, writes valid src paths, and keeps secrets out of output', async () => {
  answers.input.push('https://example.supabase.co'); answers.password.push('sb_publishable_fixture-key', 'sb_secret_fixture-admin');
  await connectCommand(root, 'supabase');
  expect(await readFile(path.join(root, 'src/proxy.ts'), 'utf8')).toContain('function proxy');
  expect(await readFile(path.join(root, 'src/lib/supabase/server.ts'), 'utf8')).toContain('await cookies()');
  answers.select.push('nvidia', 'supabase'); answers.password.push('nvapi-fixture-provider-key');
  answers.input.push('meta/llama-3.1-8b-instruct', 'https://integrate.api.nvidia.com/v1');
  await connectCommand(root, 'ai');
  const env = parse(await readFile(path.join(root, '.env.local')));
  expect(env.NVIDIA_API_KEY).toBe('nvapi-fixture-provider-key');
  expect(await readFile(path.join(root, 'src/app/api/ai/route.ts'), 'utf8')).toContain('supabase.auth.getUser');
  const output = vi.mocked(console.log).mock.calls.flat().join('\n');
  expect(output).not.toContain('nvapi-fixture-provider-key'); expect(output).not.toContain('sb_secret_fixture-admin');
  expect(await readFile(path.join(root, '.stackwire/manifest.json'), 'utf8')).not.toContain('nvapi-fixture-provider-key');
});
it('rejects a service-role key entered as the browser key before writing files', async () => {
  answers.input.push('https://example.supabase.co'); answers.password.push('sb_secret_wrong-key');
  await expect(connectCommand(root, 'supabase')).rejects.toThrow('public Supabase key');
  await expect(readFile(path.join(root, '.env.local'))).rejects.toThrow();
});
