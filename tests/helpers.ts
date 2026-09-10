import type { Manifest } from '../src/types.js';
import { analyzeSource } from '../src/lib/analyze.js';
export function manifest(code: Record<string, string> = {}): Manifest {
  const sources = Object.entries(code).map(([file, text]) => analyzeSource(file, text));
  return { version: 1, scannedAt: '', root: '/project',
    stack: { next: '^16.0.0', appDir: 'app', typescript: true, shadcn: false, supabase: false,
      aiProviders: [], vercelLinked: false, vercelConfig: false, gitRemote: 'https://github.com/example/app.git' },
    files: Object.keys(code), sources, dependencies: {},
    env: { localKeys: [], emptyKeys: [], referencedKeys: [...new Set(sources.flatMap(s => s.env.map(e => e.key)))] },
    tsconfig: { baseUrl: '.', paths: {} }, components: null, vercel: null, warnings: [] };
}
