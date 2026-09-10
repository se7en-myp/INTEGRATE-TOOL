import { scan, saveManifest } from '../lib/scan.js';
export async function initCommand(root: string): Promise<void> {
  const manifest = await scan(root);
  await saveManifest(manifest);
  console.log('\nstackwire — integration inventory\n');
  console.table([
    ['Next.js', manifest.stack.next ?? 'missing'],
    ['App Router', manifest.stack.appDir ?? 'missing'],
    ['TypeScript', manifest.stack.typescript ? 'tsconfig.json' : 'missing'],
    ['shadcn/ui', manifest.stack.shadcn ? 'components.json' : 'missing'],
    ['Supabase', manifest.stack.supabase ? manifest.sources.filter(s => s.supabase.length).map(s => s.path).join(', ') || 'dependency only' : 'missing'],
    ['AI SDK', manifest.stack.aiProviders.join(', ') || (manifest.sources.some(s => s.ai) ? 'provider fetch calls' : 'missing')],
    ['Vercel', manifest.stack.vercelLinked ? 'linked' : manifest.stack.vercelConfig ? 'config present, not linked' : 'not linked'],
    ['Git origin', manifest.stack.gitRemote ?? 'missing'],
    ['Local env keys', String(manifest.env.localKeys.length)],
    ['Referenced env keys', String(manifest.env.referencedKeys.length)],
  ].map(([piece, detected]) => ({ piece, detected })));
  for (const warning of manifest.warnings) console.log(`WARN ${warning}`);
  console.log('\nSaved .stackwire/manifest.json (names and metadata only; no env values). Next: stackwire check');
}
