# Void (void.cloud): should Epoch adopt it? (2026-10-15)

**Recommendation: no, not now.** Void would replace things Epoch has already built and tested, it
cannot host three things Epoch depends on, and its future is uncertain. Recheck if Cloudflare ships
Void's ideas in Workers or the `cf` CLI, or open-sources the platform with a stated roadmap.

## What Void is

Void (<https://void.cloud>, MIT, <https://github.com/voidzero-dev/void>) is VoidZero's Vite-native
SDK, CLI and deploy platform for Cloudflare Workers. It has two parts:

- **The SDK.** It provides `void/db` (Drizzle over D1, Postgres or MySQL), `void/kv`,
  `void/storage` (R2), `void/ai`, `void/queues`, `crons/`, WebSocket routes compiled to Durable
  Objects, and env-var schemas. Native Void apps also get Hono-based file routing (`routes/**/*.ts`,
  `defineHandler`, `defineMiddleware`), page loaders and actions, Void-managed auth, and a typed
  `fetch` client generated from the route files.
- **The CLI and platform.** `void deploy` builds the app, *infers* its resources from imports,
  provisions them, applies migrations (history kept in `void.lock.json`) and publishes it. A
  self-hostable platform adds team access, logs and rollbacks.

It has 175 stars and no tagged release, and it publishes no stability label. On 2026-06-04 VoidZero
was acquired by Cloudflare. Cloudflare's announcement calls Void a "testbed" whose lessons "belong
inside Cloudflare", says it intends to open-source the Void platform "over time", and does not
commit to Void as a product.

## The two questions asked

**Does zod have to go? No.** `defineHandler.withValidator` accepts any Standard Schema library, and
zod 4 implements Standard Schema. The 775 lines of `src/lib/server/validation/schemas.ts` would
carry over unchanged. Even moving to valibot would be optional; its main gain is bundle size, and
that matters little on the server.

**Does routing change? Only if Epoch drops SvelteKit.** Void has two modes:

| | Framework mode (keep SvelteKit) | Native mode (drop SvelteKit) |
|---|---|---|
| Routing | SvelteKit's, unchanged | Void `routes/` (Hono) and `pages/` |
| Validation | Epoch's own `apiHandler`, as now | `withValidator` (zod still works) |
| Typed fetch client | Not documented as available | Yes |
| Void-managed auth | Not supported | Yes, but Epoch uses Cloudflare Access |
| What it adds | `void/*` helpers, resource inference, `void deploy` | All of the above |

In framework mode, Void is mostly a deploy and provisioning layer. Native mode means rewriting the
app.

## What Epoch would gain

1. **Less deploy plumbing, in theory.** `void deploy` covers part of what `tools/setup` (about
   9,500 lines including tests), `scripts/deploy-config.mjs` and the Workers Builds wiring
   (ADR-043) do. This is the only significant gain.
2. **Typed queues** (`defineQueue<T>`) instead of the hand-written `Env` cast in
   `workers/entry.ts`. Small: there is one queue.
3. **A typed fetch client** in native mode only. `src/lib/shared/api-contracts.ts` and
   `src/lib/api/*` already give the client its types, so this would replace working code rather
   than fill a gap.
4. **Hono middleware** in native mode. `apiHandler`/`treeHandler` already centralise the 401, the
   public-visitor 403 (ADR-041/052), body and query validation and the error envelope, and the
   privacy-matrix test relies on them.

## What blocks it or costs Epoch

1. **Workflows.** `GedcomExportWorkflow` (ADR-040) is exported from the custom entry
   `workers/entry.ts`. Void documents neither Workflows nor custom Worker entries, in either mode.
   Its generated `.void-wrangler.jsonc` would also take over from `wrangler.jsonc` (`void init`
   migrates root wrangler files). That clashes with Important Note 1, which exists because one tool
   already overwrites the entry. This blocks adoption until Void documents a way through.
2. **Migrations.** Epoch's schema is the 33 SQL files under `drizzle/`, including the FTS5 table and
   its triggers (ADR-049), applied by `wrangler d1 migrations apply` and checked at runtime by
   `schema-status.ts`. Void keeps its own append-only history in `void.lock.json`. Running two
   sources of truth for the schema of a genealogy database that must not lose data is not worth the
   risk. Disabling Void's migrations leaves less of Void worth having.
3. **Auth.** Cloudflare Access and Epoch's own roles (ADR-001/026/034) stay whichever mode is used.
   Void's auth is unavailable in framework mode and not wanted in native mode.
4. **Setup tooling still needed.** Install ownership (`install_meta`), the Access team domain and
   AUD, the R2 lifecycle merge, email-sender verification, `doctor`, and adopting an existing
   install are all Epoch-specific. Void would replace only provisioning and deploy, so `tools/setup`
   would shrink but not go away. Resource inference conflicts with ADR-043's careful
   adopt-don't-create rules (keyed by name, no D1 id in git).
5. **Dead-letter and queue semantics.** Void-managed queues configure no dead-letter queue. Its
   defaults (`maxBatchTimeout` 5 s) differ from Epoch's 30 s, and Void does not document adopting an
   existing named queue (`epoch-genealogy-import-queue`).
6. **Product risk.** It is pre-release, has no release tags, and its owner has signalled that its
   ideas will move into Cloudflare's own products. ADR-025 set the bar for adopting a VoidZero tool
   (Vite+): run it in this repository through dev, build, deploy dry-run, both Vitest projects and
   e2e, and record the result. The same bar applies here, and Void currently fails it on paper.

## How much work it would take

| Option | Work | What it delivers |
|---|---|---|
| **A. Framework mode, deploy only** | ~1–2 weeks. Add `voidPlugin`, `void.config.ts` and tsconfig changes; reconcile the generated wrangler config with `workers/entry.ts`, Workflows and `send_email`; choose one migration system; rework setup, `deploy-config.mjs` and the Workers Builds trigger; re-verify ADR-043 on a real install. Blocked until Workflows and a custom entry are supported. | Fewer lines in `tools/setup`; `void/*` helpers that duplicate `getDb` and `getPlatformBindings` |
| **B. Framework mode plus `void/*` in services** | A, plus 1–2 days | Little. Services already receive a `DbClient`, and swapping the binding source changes nothing in the layering |
| **C. Native mode** | ~6–10+ weeks. Port the 92 `+server.ts` endpoints to `routes/` (about 89 already use `apiHandler`/`treeHandler`, so that part is mechanical); rewrite every page, layout, load function, `hooks.server.ts` (Access, schema gate, CSP, public visitor), error pages and the e2e suite; rebuild the privacy-matrix test on Hono middleware; plus all of A | A typed fetch client and Hono routing, both of which Epoch already has equivalents for. Gives up SvelteKit 3, which ADR-006 and the whole UI are built on |

zod work in every option: **none required.** A valibot swap would be about 1–2 days for
`schemas.ts`, `validation/index.ts`, `handler.ts` and the tests, but nothing calls for it.

## Verdict

Not worth it. The only meaningful gain is deploy and provisioning simplification, and Epoch has
already paid that cost in `tools/setup`, which handles concerns Void does not cover (Access,
install ownership, R2 lifecycle, adoption). Against that: an undocumented path for Workflows and
the custom entry, a second migration system for a lossless data store, a migration whose product
may be folded into Cloudflare, and, in native mode, a rewrite of the UI layer. zod is not a reason
either way; it already works with Void.

**Revisit when** (a) Void, or whatever replaces it in Workers or the `cf` CLI, documents Workflows,
custom Worker exports and adopting existing D1, R2 and queue resources and Drizzle/wrangler
migrations, and has tagged releases; or (b) `tools/setup` becomes a maintenance burden large enough
to justify a spike. A spike follows the ADR-025 bar: framework mode on a branch, through dev
against local D1, `vite build`, a deploy dry-run with the export workflow, both Vitest projects and
the e2e specs, with the results recorded here.
