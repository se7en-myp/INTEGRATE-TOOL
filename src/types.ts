export type Status = 'PASS' | 'FAIL' | 'WARN';
export type Severity = 'critical' | 'error' | 'warning' | 'info';
export type Environment = 'development' | 'preview' | 'production';
export interface Finding {
  rule: string;
  status: Status;
  severity: Severity;
  message: string;
  fix?: string;
  file?: string;
  line?: number;
}
export interface EnvReference { key: string; file: string; line: number }
export interface SourceInfo {
  path: string;
  client: boolean;
  serverOnly: boolean;
  serverAction: boolean;
  imports: string[];
  resolvedImports: string[];
  env: EnvReference[];
  dynamicEnv: boolean;
  supabase: Array<'browser' | 'server' | 'shared'>;
  ai: boolean;
  aiRequest: boolean;
  hardcodedSecretLines: number[];
}
export interface Manifest {
  version: 1;
  scannedAt: string;
  root: string;
  stack: {
    next: string | null;
    appDir: string | null;
    typescript: boolean;
    shadcn: boolean;
    supabase: boolean;
    aiProviders: string[];
    vercelLinked: boolean;
    vercelConfig: boolean;
    gitRemote: string | null;
  };
  dependencies: Record<string, string>;
  files: string[];
  sources: SourceInfo[];
  env: { localKeys: string[]; emptyKeys: string[]; referencedKeys: string[]; unsafePublicKeys?: string[] };
  tsconfig: { paths: Record<string, string[]>; baseUrl: string };
  components: Record<string, unknown> | null;
  vercel: Record<string, unknown> | null;
  warnings: string[];
}
export interface VercelState {
  available: boolean;
  linked: boolean;
  keys?: Partial<Record<Environment, string[]>>;
  error?: string;
}
export interface RuleContext { manifest: Manifest; vercel?: VercelState }
export type Rule = (context: RuleContext) => Finding[];
