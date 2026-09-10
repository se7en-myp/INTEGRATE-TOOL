# stackwire

**Diagnose the connections in your Next.js stack—not just whether packages are installed.**

stackwire is a TypeScript CLI for Next.js App Router, shadcn/ui, Supabase, OpenAI-compatible AI providers, Git/GitHub, and Vercel. It inventories a project, checks integration boundaries, scaffolds working server/browser integrations, and runs a fail-fast runtime checklist.

## Installation

Requires **Node.js 20.19+** for the CLI. Use Node.js 22+ for the included Next.js fixture and current integration dependencies. Linux is tested; macOS should work. Native Windows subprocess support is not yet validated; use WSL.

Once this package has been published to npm:

```sh
npx stackwire --help
npx stackwire init
# Or install per project:
npm install --save-dev stackwire
```

**Release status:** this repository is npm-ready but is not automatically published. Until a maintainer publishes the package, use the local build or a packed tarball rather than assuming `npx stackwire` resolves to this code:

```sh
npm ci
npm run build
node dist/cli.js --help
node dist/cli.js -C /path/to/your/app init

npm pack
# From another project, using the actual absolute path to the tarball:
npm exec --package=/path/to/stackwire-0.1.0.tgz -- stackwire init
```

Run commands at the **Next.js application root**, not the monorepo root. Use `-C, --cwd <directory>` to select an app. No command publishes or deploys your application automatically.

## Quickstart

```sh
npx stackwire init
npx stackwire check
npx stackwire connect supabase
npx stackwire connect ai
npx stackwire connect vercel
npx stackwire doctor --table healthcheck
```

Early checks are expected to fail on an incomplete project. After scaffolding, update existing imports/call sites, remove obsolete shared clients, and rerun `check`. The connection wizards do **not** blindly rewrite application code or erase existing middleware logic.

## Commands

Every command supports `--help` with examples.

### `stackwire init`

```sh
stackwire init
stackwire -C ./apps/web init
```

Scans `package.json`, root or `src/app`, TypeScript configuration, `components.json`, Supabase factories, AI dependencies/provider calls, `.env.local`, `vercel.json`, `.vercel/project.json`, and the Git origin. Prints a detected/missing inventory table and saves `.stackwire/manifest.json`.

The manifest contains env **names**, reference locations, import-graph metadata, public-key safety flags, and selected config metadata—not env values or source text. Credentials are stripped from remote URLs and serialized metadata. Treat the manifest as private project metadata and keep `.stackwire/` ignored by Git.

`check`, `connect`, and `doctor` use the same manifest model. They rescan and refresh it rather than trusting potentially stale security results. An initial `init` is useful but not mandatory.

### `stackwire check`

```sh
stackwire check
stackwire check --offline
stackwire check --json
stackwire check --offline --strict
```

| Option | Behavior |
| --- | --- |
| `--offline` | Do not invoke the Vercel CLI or make remote environment checks |
| `--json` | Print `{ "version": 1, "findings": [...] }` to stdout without progress output |
| `--strict` | Return a failure exit code for warnings as well as failures |

Each finding has `rule`, `status`, `severity`, `message`, and, where applicable, `file`, `line`, and a one-line `fix`. Reports are sorted **critical → error → warning → info**.

| Rule | Connection being checked |
| --- | --- |
| `supabase-boundary` | Separate browser/server factories; shared plain clients; server factories reachable from browser code; missing session-refresh entry point |
| `env-consistency` | Static `process.env.KEY`, literal bracket lookups, and destructuring vs. `.env.local`; missing, empty, unused, and dynamic references |
| `secret-leakage` | AI/service-role keys in client import graphs; public privileged env names or recognizable privileged values; hardcoded credential patterns; server-only modules imported by clients |
| `vercel-env` | Local key names vs. Vercel **development, preview, and production**, independently |
| `shadcn-config` | `components.json` aliases against resolved tsconfig paths and actual files; CSS and Tailwind configuration paths, including config-less Tailwind v4 |
| `ai-route` | Provider SDKs/endpoints in client graphs; non-App-Router API entry points; missing guarded server helpers/routes |
| `deployment-wiring` | Missing/non-GitHub origin, disabled Git deployments, and conflicting Vercel framework overrides |

Missing optional services or unavailable remote checks are **WARN / skipped**, not successful verification. Framework-provided env names such as `NODE_ENV`, `NEXT_RUNTIME`, and core Vercel runtime variables do not require `.env.local` entries.

**Page policy:** App Router pages are server components by default. Nevertheless, this tool deliberately requires an explicit `import 'server-only'` or server-action boundary for pages that read privileged keys, as a conservative safety policy. Prefer reading those keys in a guarded helper rather than in page code.

### `stackwire connect supabase`

Prompts for the project URL, public anon/publishable key, and optional server-only service-role/secret key. Rejects recognizable privileged keys entered as public keys.

Generates under the project root, or under `src/` for a `src/app` project:

```text
lib/supabase/client.ts      createBrowserClient, for Client Components
lib/supabase/server.ts      async cookies + createServerClient, guarded by server-only
lib/supabase/middleware.ts  session refresh, forwarding request/response cookies
lib/supabase/admin.ts       optional service-role client, guarded by server-only
proxy.ts                   Next.js 16+ request entry point
# middleware.ts instead for earlier Next.js versions
```

Writes `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and, if supplied, `SUPABASE_SERVICE_ROLE_KEY` to `.env.local`. The modern publishable key can be stored under the anon-key variable name used by these generated clients.

If middleware/proxy already exists, the default is to **keep it** and generate a reusable session-refresh helper. Integrate `updateSession(request)` into the existing pipeline, preserving its response/cookies. An explicitly confirmed replacement is also offered with a diff and a warning that existing auth/rewrites would be removed. JavaScript middleware is not silently migrated.

The wizard offers to install `@supabase/ssr`, `@supabase/supabase-js`, and `server-only`. Package-manager installation is separately confirmed; pnpm/yarn/bun projects receive manual dependency instructions instead of an extra npm lockfile.

Update your application imports:

```ts
// Client Component:
import { createClient } from '@/lib/supabase/client';
// Server Component / Route Handler / Server Action, in a different file:
import { createClient } from '@/lib/supabase/server';
const supabase = await createClient();
```

The examples assume your app has the `@/*` alias; generated inter-file imports are relative. Enable and review RLS. The admin client bypasses RLS and must never substitute for ordinary user access. Session refresh is not an authorization policy.

### `stackwire connect ai`

Prompts for provider, hidden API key, an account-accessible model ID, compatible base URL, and endpoint authentication. Generates:

```text
lib/ai/client.ts
app/api/ai/route.ts
```

| Provider | Server-only key | Default base URL | Suggested model |
| --- | --- | --- | --- |
| OpenAI | `OPENAI_API_KEY` | `https://api.openai.com/v1` | `gpt-4o-mini` |
| OpenRouter | `OPENROUTER_API_KEY` | `https://openrouter.ai/api/v1` | `openai/gpt-4o-mini` |
| NVIDIA | `NVIDIA_API_KEY` | `https://integrate.api.nvidia.com/v1` | `meta/llama-3.1-8b-instruct` |

Also configures `AI_MODEL` and `AI_BASE_URL`. Model availability is provider/account-specific; defaults are suggestions, not availability guarantees. Custom endpoints must use HTTPS, except HTTP on localhost. **Only use an endpoint you trust: your key is sent there.**

The client uses the OpenAI SDK with provider-specific `baseURL`, lazy initialization, timeout, and bounded retries. The route uses Node.js runtime, a 16 KiB request-body limit, a 1–4000 character prompt, a bounded completion, generic error responses, and no-store caching.

Authentication choices:

- **Supabase session:** available when `lib/supabase/server.ts` exists. Uses verified `getUser()` and requires same-origin browser requests. Your existing helper must export the async `createClient` contract shown above.
- **Private bearer token:** requires a separate random `AI_ROUTE_TOKEN` of at least 32 characters. Uses constant-time comparison. **Server-to-server only:** never put this token in a browser or a `NEXT_PUBLIC_` variable.

A logged-in browser using the Supabase-session route can call:

```ts
const response = await fetch('/api/ai', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: 'Explain this error briefly.' }),
});
if (!response.ok) throw new Error('AI request failed');
const result: { text: string } = await response.json();
```

For broad production access, configure application-specific authorization, distributed rate limiting, quotas, and provider spending limits. The scaffold supplies working authentication but cannot infer your billing or access policy. Existing UI components are not automatically rewritten.

### `stackwire connect vercel`

Requires an installed, authenticated Vercel CLI (`npm install --save-dev vercel`, then `vercel login`). Checks the project link and offers `vercel link` if needed.

Lists all three standard environments, prompts for upload targets (development selected by default), and asks separately before each missing key is uploaded through `vercel env add`. Values travel via **stdin**, never shell commands or arguments. Empty values are skipped; recognized public secrets are refused. Existing remote values are never overwritten. If an upload fails, prior successful uploads remain.

This compares **key names**, not secret values. It does not verify branch-specific preview overrides or custom environments. Redeploy after changing env vars. In Vercel project settings, verify the connected GitHub repository, production branch, Root Directory, and build configuration; `vercel link` alone does not guarantee Git auto-deploys.

### `stackwire doctor`

```sh
stackwire doctor --table healthcheck
stackwire doctor --yes --table profiles --schema public --provider openrouter
stackwire doctor --yes --skip-ai --skip-supabase
```

Before runtime work, checks for known secret leakage. Then reports each step as it runs and **stops at the first failure**:

1. Supabase Data API `SELECT ... LIMIT 1`, with the public anon/publishable key and specified table. Does not print row contents or bypass RLS.
2. A minimal AI chat completion with a 16-token output budget; does not print completion text or raw provider error bodies.
3. `npm run build`, capturing only a small, redacted excerpt around the first reported build error.
4. Vercel env-name parity across the three standard environments, if linked.

| Option | Meaning |
| --- | --- |
| `-y, --yes` | Authorize runtime requests and repository build scripts without prompting; required in noninteractive use |
| `--table <name>` | Supabase table; otherwise reads `SUPABASE_HEALTH_TABLE`, or prompts interactively |
| `--schema <name>` | Exposed Data API schema; default `public` |
| `--provider <name>` | `openai`, `openrouter`, or `nvidia`; required when more than one provider key is configured |
| `--build-timeout <seconds>` | 1–3600 seconds; default 300 |
| `--skip-supabase` | Skip Supabase query |
| `--skip-ai` | Skip the billable AI request |
| `--skip-build` | Skip the production build |
| `--skip-vercel` | Skip Vercel parity |

Network probes time out after 30 seconds and refuse redirects. Build timeouts terminate the subprocess group on Unix. Only run `doctor` in **trusted repositories**: npm build scripts can execute arbitrary code and dependency lifecycle hooks. Live AI tests can incur a small charge. Absent services are explicitly skipped; skipped steps do not establish health. A successful empty Supabase result may be RLS-filtered and does not prove user-specific read authorization.

## Safety and limitations

- No telemetry or automatic credential collection. `init` and offline checks do not execute application modules or fetch secrets.
- No full secret values in prompts, manifests, reports, generated source, or env diffs. `.env.local` is written with mode `0600`; the wizard refuses to write credentials to an already Git-tracked `.env.local`.
- Existing generated files receive a redacted diff and explicit approval. The whole file plan is reviewed before writing; declining any replacement cancels that plan. Identical files are left alone. Files are atomically replaced individually, but filesystem failure during a multi-file write is not a transactional rollback. Review Git diffs after scaffolding.
- Scaffolding rejects path traversal and symlink targets. Package-manager-managed package/lockfiles are modified only after the separate install prompt; their exact changes are managed by the package manager.
- Env checks intentionally compare against **`.env.local` only**, not all Next.js env-file precedence rules. Dotenv variable expansion is not evaluated. Use explicit values; dynamic env aliases and runtime-computed imports cannot be fully audited.
- TypeScript AST analysis follows resolvable local imports/re-exports, including tsconfig aliases, with Server Action boundaries. It is a heuristic diagnostic, not a complete information-flow analysis or a security certification. Custom wrappers, complex package exports, custom env names, and third-party dependencies can require manual review.
- Vendor/build/cache directories, symlinks, `examples/`, and `test-fixture/` subtrees are excluded when scanning a parent project. Selecting the fixture itself with `-C test-fixture` works normally.
- shadcn checks validate paths, not arbitrary Tailwind plugin semantics or whether every UI action reaches a real API. The fixture demonstrates a real button-to-route connection.
- Git/Vercel checks do not prove webhook delivery, dashboard settings, actual deployed builds, browser UI flows, or remote secret-value equality.

Exit codes: `0` = no failing findings/completed selected checks; `1` = diagnostics/runtime failure, strict warnings, or operational error. An interactive cancellation applies no pending scaffold file plan and is not itself an error.

## Local development and fixture

```sh
npm ci
npm run build
npm test
npm run typecheck
npm ci --prefix test-fixture
npm run test:templates
npm run test:templates -- --build
```

The template validator typechecks all three providers with both auth modes against real installed dependencies, checks integration boundaries, and optionally builds a temporary generated Next.js app. It does not require real service credentials. Unit tests mock network calls and prompt answers; CLI tests exercise actual processes and exit codes.

The included fixture has Next.js App Router, TypeScript, Tailwind v4, a shadcn-style Button using Radix/CVA, and a working `/api/echo` route. It **deliberately shares one plain Supabase client** between a browser page and a server route, and starts without Supabase values.

```sh
node dist/cli.js -C test-fixture init
node dist/cli.js -C test-fixture check --offline  # Expected failures
cp test-fixture/.env.example test-fixture/.env.local
node dist/cli.js -C test-fixture connect supabase
node dist/cli.js -C test-fixture connect ai
# Update the fixture's old sharedSupabase imports before expecting checks to pass.
npm run dev --prefix test-fixture
# In another terminal:
node dist/cli.js -C test-fixture doctor --table your_table
```

Never commit real fixture credentials. For a no-network build-only check:

```sh
node dist/cli.js -C test-fixture doctor --yes --skip-supabase --skip-ai --skip-vercel
```

### Continuous integration

`scripts/ci.example.yml` contains a GitHub Actions template for Node.js 20/22 CLI tests and Node.js 22 generated-integration builds. It is **not active**: the development session did not have permission to create GitHub workflows. A repository maintainer with workflow-write permission can copy it to `.github/workflows/ci.yml` and commit it to enable CI.

### Adding a rule

Each rule is an independent pure module under `src/rules/` implementing `Rule` from `src/types.ts`. It receives `{ manifest, vercel? }` and returns `Finding[]`. Add it to the registry in `src/rules/index.ts`, then add passing/failing examples in `tests/`. Network discovery belongs outside rules so tests remain deterministic.

### Releasing to npm

Run tests and `npm pack --dry-run`, check name/version ownership, then publish using the maintainer's npm account:

```sh
npm run build
npm test
npm pack --dry-run
npm publish --access public
```

`prepack` runs `tsc`. Only `dist/`, this README, the license, and package metadata are shipped. No fixture or env files are published. npm account access, package-name ownership, and actual publication are separate maintainer steps.

## References

- [Supabase SSR for Next.js](https://supabase.com/docs/guides/auth/server-side/nextjs)
- [Next.js Proxy](https://nextjs.org/docs/app/api-reference/file-conventions/proxy)
- [Vercel CLI environment variables](https://vercel.com/docs/cli/env)

MIT licensed.
