import { expect, it } from 'vitest';
import { run } from '../src/lib/process.js';
it('terminates nested build workers when a command times out', async () => {
  const started = Date.now();
  const script = `const { spawn } = require('node:child_process'); spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' }); setInterval(() => {}, 1000);`;
  const result = await run(process.execPath, ['-e', script], process.cwd(), { timeout: 500 });
  expect(result.timedOut).toBe(true);
  expect(Date.now() - started).toBeLessThan(5000);
}, 10_000);
it('passes sensitive input over stdin without echoing it', async () => {
  const result = await run(process.execPath, ['-e', `process.stdin.resume(); process.stdin.on('end', () => console.log('received'));`], process.cwd(), { input: 'private-test-value' });
  expect(result.code).toBe(0); expect(result.stdout.trim()).toBe('received');
  expect(result.stderr).not.toContain('private-test-value');
});
