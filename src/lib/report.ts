import chalk from 'chalk';
import type { Finding } from '../types.js';
import { redact } from './secrets.js';
export function printReport(findings: Finding[]): void {
  for (const item of findings) {
    const color = item.status === 'PASS' ? chalk.green : item.status === 'FAIL' ? chalk.red : chalk.yellow;
    const location = item.file ? ` (${item.file}${item.line ? ':' + item.line : ''})` : '';
    console.log(redact(`${color(item.status.padEnd(4))} ${item.severity === 'critical' ? chalk.bgRed.white(' CRITICAL ') + ' ' : ''}[${item.rule}] ${item.message}${location}`));
    if (item.fix) console.log(redact(chalk.dim(`     Fix: ${item.fix}`)));
  }
  const count = (status: string): number => findings.filter(f => f.status === status).length;
  console.log(`\n${count('PASS')} passed, ${count('FAIL')} failed, ${count('WARN')} warnings.`);
}
