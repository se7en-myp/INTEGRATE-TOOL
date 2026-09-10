import path from 'node:path';
import type { Finding, Rule } from '../types.js';
import { pass, warn } from './shared.js';
export const shadcnSanity: Rule = ({ manifest }) => {
  if (!manifest.components) return [warn('shadcn-config', 'components.json is missing.', 'Initialize shadcn with npx shadcn@latest init, if this app uses shadcn/ui.')];
  const findings: Finding[] = [];
  const fail = (message: string, fix: string): void => { findings.push({ rule: 'shadcn-config', status: 'FAIL', severity: 'error', message, fix }); };
  const aliases = manifest.components.aliases;
  if (!aliases || typeof aliases !== 'object' || Array.isArray(aliases)) fail('components.json has no valid aliases.', 'Configure aliases.components and aliases.utils to match tsconfig.json.');
  else {
    const entries = aliases as Record<string, unknown>;
    for (const key of ['components', 'utils']) if (typeof entries[key] !== 'string') fail(`Missing aliases.${key}.`, 'Set the required shadcn alias.');
    for (const [name, alias] of Object.entries(entries)) {
      if (typeof alias !== 'string') { fail(`aliases.${name} must be a string.`, 'Use a tsconfig path alias.'); continue; }
      let targets: string[] = [];
      for (const [pattern, mappings] of Object.entries(manifest.tsconfig.paths)) {
        const [prefix, suffix = ''] = pattern.split('*');
        if (pattern.includes('*') ? alias.startsWith(prefix!) && alias.endsWith(suffix) : alias === pattern) {
          const middle = pattern.includes('*') ? alias.slice(prefix!.length, suffix ? -suffix.length : undefined) : '';
          targets = mappings.map(mapping => path.posix.normalize(path.posix.join(manifest.tsconfig.baseUrl, mapping.replace('*', middle))));
          break;
        }
      }
      if (!targets.length) fail(`aliases.${name} does not match tsconfig paths.`, `Align the ${name} alias in components.json and tsconfig.json.`);
      else if (!targets.some(target => manifest.files.some(file => file === target || file.startsWith(target + '/') || ['.ts', '.tsx', '.js', '.jsx'].some(ext => file === target + ext)))) fail(`aliases.${name} resolves to a missing path.`, 'Create the target module/directory or correct the alias.');
    }
  }
  const tailwind = manifest.components.tailwind as Record<string, unknown> | undefined;
  if (!tailwind || typeof tailwind.css !== 'string' || !manifest.files.includes(path.posix.normalize(tailwind.css.replace(/^\.\//, '')))) fail('shadcn Tailwind CSS entry does not exist.', 'Set tailwind.css to your actual global stylesheet.');
  // Tailwind v4 deliberately uses an empty config path; v3 requires a file.
  const v4 = /^[^\d]*4\./.test(manifest.dependencies.tailwindcss ?? '');
  if (tailwind && typeof tailwind.config === 'string' && tailwind.config) {
    if (!manifest.files.includes(tailwind.config.replace(/^\.\//, ''))) fail('Configured Tailwind config file is missing.', 'Correct tailwind.config in components.json.');
  } else if (!v4) fail('No Tailwind config path configured for this non-v4 project.', 'Set tailwind.config to the existing Tailwind configuration.');
  return findings.length ? findings : [pass('shadcn-config', 'shadcn aliases, CSS entry, and Tailwind config paths are consistent.')];
};
