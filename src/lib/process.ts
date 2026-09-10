import { spawn } from 'node:child_process';
export interface RunResult { code: number; stdout: string; stderr: string; timedOut: boolean }
export async function run(command: string, args: string[], cwd: string, options: {
  input?: string; timeout?: number; inherit?: boolean;
} = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    const grouped = process.platform !== 'win32' && !options.inherit;
    const child = spawn(command, args, { cwd, shell: false, detached: grouped,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: options.inherit ? 'inherit' : ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false;
    const terminate = (signal: NodeJS.Signals): void => {
      try {
        if (grouped && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch { /* Process/group has already exited. */ }
    };
    let forceTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      terminate('SIGTERM');
      forceTimer = setTimeout(() => terminate('SIGKILL'), 2000);
      forceTimer.unref();
    }, options.timeout ?? 30_000);
    const clearTimers = (): void => { clearTimeout(timer); if (forceTimer) clearTimeout(forceTimer); };
    child.stdout?.on('data', (data: Buffer) => { if (stdout.length < 2_000_000) stdout += data.toString(); });
    child.stderr?.on('data', (data: Buffer) => { if (stderr.length < 2_000_000) stderr += data.toString(); });
    child.stdin?.on('error', () => {});
    if (!options.inherit) child.stdin?.end(options.input);
    child.on('error', () => { clearTimers(); resolve({ code: 127, stdout, stderr: 'Command could not be started.', timedOut }); });
    child.on('close', (code) => { clearTimers(); resolve({ code: code ?? 1, stdout, stderr, timedOut }); });
  });
}
