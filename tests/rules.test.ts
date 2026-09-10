import { describe, expect, it } from 'vitest';
import { manifest } from './helpers.js';
import { analyzeSource } from '../src/lib/analyze.js';
import { envConsistency } from '../src/rules/env.js';
import { secretLeakage } from '../src/rules/security.js';
import { supabaseBoundary } from '../src/rules/supabase.js';
import { shadcnSanity } from '../src/rules/shadcn.js';
import { aiRouteSanity } from '../src/rules/ai.js';
import { vercelParity } from '../src/rules/vercel.js';
import { deploymentWiring } from '../src/rules/deployment.js';
import { runRules } from '../src/rules/index.js';
import { parseVercelEnv } from '../src/lib/vercel.js';
import { redact, safeRemote } from '../src/lib/secrets.js';

describe('source analysis', () => {
  it('ignores comments and strings, handles brackets and destructuring', () => {
    const result = analyzeSource('x.ts', `// process.env.FAKE\nconst text = 'process.env.FAKE';\nprocess.env.REAL; process.env['BRACKET']; const { DESTRUCTURED: renamed } = process.env;`);
    expect(result.env.map(e => e.key)).toEqual(['REAL', 'BRACKET', 'DESTRUCTURED']);
  });
  it('detects directives after comments, not arbitrary string expressions', () => {
    expect(analyzeSource('x.tsx', `/* header */ 'use client'; export default 1`).client).toBe(true);
    expect(analyzeSource('x.tsx', `const text = 'use client'`).client).toBe(false);
  });
  it('does not include type-only imports in browser graph', () => {
    expect(analyzeSource('x.ts', `import type { A } from './server'; export type { B } from './secret'`).imports).toEqual([]);
  });
  it('recognizes aliased Supabase factories', () => {
    expect(analyzeSource('x.ts', `import { createServerClient as make } from '@supabase/ssr'; make(url, key)` ).supabase).toEqual(['server']);
  });
});
describe('environment consistency', () => {
  it('flags missing, blank, and unused keys', () => {
    const m = manifest({ 'x.ts': 'process.env.MISSING; process.env.BLANK;' });
    m.env.localKeys = ['UNUSED', 'BLANK']; m.env.emptyKeys = ['BLANK'];
    const result = envConsistency({ manifest: m });
    expect(result.filter(r => r.status === 'FAIL')).toHaveLength(2);
    expect(result.some(r => r.status === 'WARN' && r.message.includes('UNUSED'))).toBe(true);
  });
  it('passes when references match and ignores framework variables', () => {
    const m = manifest({ 'x.ts': 'process.env.OK; process.env.NODE_ENV;' }); m.env.localKeys = ['OK'];
    expect(envConsistency({ manifest: m })[0]?.status).toBe('PASS');
  });
  it('warns on dynamic lookups', () => {
    expect(envConsistency({ manifest: manifest({ 'x.ts': 'process.env[key]' }) })[0]?.status).toBe('WARN');
  });
});
describe('secret leakage', () => {
  it.each(['OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'NVIDIA_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY'])('flags %s in clients', key => {
    const result = secretLeakage({ manifest: manifest({ 'app/page.tsx': `'use client'; process.env.${key}` }) });
    expect(result[0]?.severity).toBe('critical');
  });
  it('flags public privileged env keys even when not referenced', () => {
    const m = manifest(); m.env.localKeys = ['NEXT_PUBLIC_OPENAI_API_KEY'];
    expect(secretLeakage({ manifest: m })[0]?.status).toBe('FAIL');
  });
  it('allows public Supabase anon keys', () => {
    expect(secretLeakage({ manifest: manifest({ 'x.tsx': `'use client'; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;` }) })[0]?.status).toBe('PASS');
  });
  it('follows transitive imports and cycles', () => {
    const m = manifest({ 'client.ts': `'use client';`, 'helper.ts': 'process.env.OPENAI_API_KEY' });
    m.sources[0]!.resolvedImports = ['helper.ts']; m.sources[1]!.resolvedImports = ['client.ts'];
    expect(secretLeakage({ manifest: m }).some(r => r.file === 'helper.ts' && r.status === 'FAIL')).toBe(true);
  });
  it('does not cross Server Action module boundaries', () => {
    const m = manifest({ 'client.ts': `'use client';`, 'action.ts': `'use server'; process.env.OPENAI_API_KEY` });
    m.sources[0]!.resolvedImports = ['action.ts'];
    expect(secretLeakage({ manifest: m })[0]?.status).toBe('PASS');
  });
  it('requires an explicit guard in privileged pages, but not API routes', () => {
    expect(secretLeakage({ manifest: manifest({ 'app/nested/page.tsx': 'process.env.OPENAI_API_KEY' }) })[0]?.status).toBe('FAIL');
    expect(secretLeakage({ manifest: manifest({ 'app/page.tsx': `import 'server-only'; process.env.OPENAI_API_KEY` }) })[0]?.status).toBe('PASS');
    expect(secretLeakage({ manifest: manifest({ 'app/api/ai/route.ts': 'process.env.OPENAI_API_KEY' }) })[0]?.status).toBe('PASS');
  });
  it('never includes hardcoded secret values in findings', () => {
    const key = 'sk-' + 'notarealkey123456789';
    const result = secretLeakage({ manifest: manifest({ 'x.ts': `const key = '${key}'` }) });
    expect(result[0]?.status).toBe('FAIL'); expect(JSON.stringify(result)).not.toContain(key);
  });
});
describe('Supabase boundaries', () => {
  it('fails a single shared factory', () => {
    const m = manifest({ 'lib/db.ts': `import { createClient } from '@supabase/supabase-js'; createClient(url, key);` }); m.stack.supabase = true;
    expect(supabaseBoundary({ manifest: m })[0]?.status).toBe('FAIL');
  });
  it('passes distinct server and browser factories with session refresh', () => {
    const m = manifest({ 'lib/client.ts': `import { createBrowserClient } from '@supabase/ssr'; createBrowserClient(url,key);`,
      'lib/server.ts': `import { createServerClient } from '@supabase/ssr'; createServerClient(url,key);`, 'proxy.ts': '' }); m.stack.supabase = true;
    expect(supabaseBoundary({ manifest: m })[0]?.status).toBe('PASS');
    m.sources[0]!.client = true; m.sources[0]!.resolvedImports = ['lib/server.ts'];
    expect(supabaseBoundary({ manifest: m }).some(r => r.status === 'FAIL')).toBe(true);
  });
});
describe('shadcn sanity', () => {
  function valid() {
    const m = manifest({ 'src/lib/utils.ts': '', 'src/components/ui/button.tsx': '', 'src/app/globals.css': '' });
    m.dependencies.tailwindcss = '^4.1.0'; m.tsconfig = { baseUrl: '.', paths: { '@/*': ['./src/*'] } };
    m.components = { aliases: { components: '@/components', utils: '@/lib/utils' }, tailwind: { css: 'src/app/globals.css', config: '' } };
    return m;
  }
  it('supports Tailwind v4 without config file', () => expect(shadcnSanity({ manifest: valid() })[0]?.status).toBe('PASS'));
  it('rejects mismatched aliases and CSS', () => {
    const m = valid(); m.tsconfig.paths = {}; m.files = [];
    expect(shadcnSanity({ manifest: m }).filter(r => r.status === 'FAIL')).toHaveLength(3);
  });
  it('requires a v3 config', () => {
    const m = valid(); m.dependencies.tailwindcss = '^3.4.0';
    expect(shadcnSanity({ manifest: m })[0]?.status).toBe('FAIL');
    (m.components!.tailwind as Record<string, string>).config = 'tailwind.config.ts'; m.files.push('tailwind.config.ts');
    expect(shadcnSanity({ manifest: m })[0]?.status).toBe('PASS');
  });
});
describe('AI route sanity', () => {
  it('flags direct browser fetches', () => {
    expect(aiRouteSanity({ manifest: manifest({ 'app/page.tsx': `'use client'; fetch('https://api.openai.com/v1/chat/completions')` }) })[0]?.severity).toBe('critical');
  });
  it('flags pages router API code', () => {
    expect(aiRouteSanity({ manifest: manifest({ 'pages/api/ai.ts': `fetch('https://openrouter.ai/api/v1/chat/completions')` }) })[0]?.status).toBe('FAIL');
  });
  it('passes a route that imports a protected helper', () => {
    const m = manifest({ 'src/app/api/ai/route.ts': '', 'src/lib/ai.ts': `import 'server-only'; import OpenAI from 'openai';` });
    m.sources[0]!.resolvedImports = ['src/lib/ai.ts'];
    expect(aiRouteSanity({ manifest: m })[0]?.status).toBe('PASS');
  });
});
describe('Vercel environment parity', () => {
  it('parses table output and empty lists, rejects ambiguous output', () => {
    expect(parseVercelEnv('Vercel CLI 48\n  name  value  environments\n  API_KEY  Encrypted  Production\n  PUBLIC_URL  Plain Text Development')).toEqual(['API_KEY', 'PUBLIC_URL']);
    expect(parseVercelEnv('> No Environment Variables found')).toEqual([]);
    expect(() => parseVercelEnv('Login expired')).toThrow();
  });
  it('does not treat production presence as preview parity', () => {
    const m = manifest(); m.stack.vercelLinked = true; m.env.localKeys = ['KEY'];
    const result = vercelParity({ manifest: m, vercel: { available: true, linked: true, keys: { production: ['KEY'], preview: [], development: ['KEY'] } } });
    expect(result).toHaveLength(1); expect(result[0]?.message).toContain('preview');
  });
  it('passes parity, warns on skips and remote-only keys, fails CLI errors', () => {
    const m = manifest(); m.stack.vercelLinked = true;
    expect(vercelParity({ manifest: m })[0]?.status).toBe('WARN');
    expect(vercelParity({ manifest: m, vercel: { available: true, linked: true, error: 'Login failed' } })[0]?.status).toBe('FAIL');
    expect(vercelParity({ manifest: m, vercel: { available: true, linked: true, keys: { production: [], preview: [], development: [] } } })[0]?.status).toBe('PASS');
    expect(vercelParity({ manifest: m, vercel: { available: true, linked: true, keys: { production: ['REMOTE'], preview: [], development: [] } } })[0]?.status).toBe('WARN');
  });
});
it('flags disabled Git deployments and framework mismatch', () => {
  const m = manifest(); m.vercel = { git: { deploymentEnabled: false }, framework: 'vite' };
  expect(deploymentWiring({ manifest: m }).filter(f => f.status === 'FAIL')).toHaveLength(2);
});
it('sorts critical findings before all other findings', () => {
  const result = runRules({ manifest: manifest({ 'app/page.tsx': `'use client'; process.env.OPENAI_API_KEY` }) });
  expect(result[0]?.severity).toBe('critical');
});
it('redacts credentials in output and remote URLs', () => {
  expect(redact('request failed: arbitrary-secret-value', ['arbitrary-secret-value'])).toBe('request failed: [REDACTED]');
  expect(safeRemote('https://user:password@github.com/team/app.git?token=secret')).toBe('https://github.com/team/app.git');
});
