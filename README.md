# Epoch

A private family-tree application for one owner and invited collaborators, inspired by webtrees
capabilities. Built with Svelte 5, SvelteKit 3, Cloudflare Workers, D1 (Drizzle), R2, Queues and
Workflows. See [AGENTS.md](./AGENTS.md) for architecture and conventions,
[docs/roadmap.md](./docs/roadmap.md) for direction and phase status, and the slice table in
[docs/improvement-plan.md](./docs/improvement-plan.md#delivery-slices) for what each slice shipped.

## Setup

Requires Node 24 or later (see `.nvmrc`).

```sh
nvm use                       # or otherwise install Node 24
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local      # creates the local D1 schema
npm run dev
```

The app runs at <http://localhost:5173>. The migrations in `drizzle/` are the only schema source.
Without `npm run db:migrate:local` (or after pulling new migrations) every request fails with a 503
that says to run it, rather than a `no such table` error. The check compares Wrangler's
`d1_migrations` record with the migration journal, so it also catches a partly applied set.

### Installing into Cloudflare

```sh
npm run setup -- --plan   # reconcile with your account and print what would change; read-only
npm run setup             # sign in, create the resources, the Access application, deploy, verify
```

Setup signs in through your browser (no API token to create), asks only what it cannot discover, and
proves that any resource it finds by name belongs to this install before using it. It assumes your
account already has a paid Workers plan, a Zero Trust organisation with an identity provider, and an
active domain; it never creates those. Everything else it needs is the D1 database, R2 bucket, queue
and Worker, one custom domain, and one Access application on `<host>/login` with an Allow policy
(chosen from your existing ones, or a new one for your email). It never edits a policy it did not
create.

Later: `npm run setup -- doctor` reports drift, `allow <email>` and `disallow <email>` edit the
policy setup created, and `teardown` deletes only what this install made. `npm run setup -- --help`
lists every flag, including the ones that answer each prompt for CI. With `--json` use
`npm run -s setup -- …` so npm’s own banner stays off stdout. State lives in
`.epoch/install.json` and the generated `wrangler.deploy.jsonc`; both are git-ignored. See
[docs/cli-setup-plan.md](./docs/cli-setup-plan.md) for the design and the checks that still need a
real account (`npm run setup -- spike`).

### Dev identity

Identity normally comes from Cloudflare Access. For local development, `.dev.vars` sets
`ACCESS_BYPASS_DEV=true`, which lets requests without a token act as a local developer
(`dev-local-user`, `developer@epoch.local`). Override the identity per request with the
`x-dev-user-sub`, `x-dev-user-email` and `x-dev-user-name` headers.

The bypass is opt-in only. It is never inferred from `NODE_ENV`, and without the flag every
request without a valid Access token is rejected with 401. Never set the flag in a deployed
environment. `.dev.vars` is git-ignored.

### Sign-in and the welcome page

Epoch uses **one** Cloudflare Access application, covering only `<host>/login`. Every other path
is plain Worker traffic and the Worker is the gate: a signed-out page load is redirected to
`/welcome?next=…`, whose "Sign in" button goes to `/login?next=…`. Access authenticates the
visitor there and sets the `CF_Authorization` cookie, then `/login` redirects to `next`. See
ADR-026 in [docs/decisions.md](./docs/decisions.md).

Application settings: path `/login` only, an Allow policy for your invitees, **Cookie Path
Attribute off** (otherwise the cookie is not sent on other paths) and Binding Cookie off.

Migrating a deployment that has the whole host behind Access plus a Bypass application:

1. Deploy this code first. It works under the old whole-host setup too.
2. **Edit the existing Access application's path to `/login`** rather than creating a new one. That
   keeps its AUD tag, so the `CF_ACCESS_AUD` secret does not change. If you create a new
   application instead, update the secret to its AUD tag.
3. Delete the Bypass application.

Verify on first deploy: that signing in returns you to the page you wanted, and that API calls
after sign-in authenticate from the cookie alone.

### Brand assets

The icons are SVGs in `static/` and `static/brand/`. After changing one, run
`npm run brand:render` to regenerate the PNGs and `favicon.ico`, and commit the output. Set
`CHROMIUM_PATH` if the installed Chromium is not the build Playwright expects.

### Seed data

With the dev server running:

```sh
npm run seed
```

This imports [docs/gedcom-data/The_Simpsons_clean.ged](./docs/gedcom-data/The_Simpsons_clean.ged) as a tree named "The
Simpsons". It does nothing if that tree already exists. If the dev server is on another port, set
`SEED_URL`, for example `SEED_URL=http://localhost:5178 npm run seed`.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run check` | Sync SvelteKit types and run `svelte-check` |
| `npm test` | Run all Vitest suites once: unit, real-D1 service tests and jsdom component tests (`*.component.test.ts`) |
| `npm run test:e2e` | Run the Playwright browser tests (see [Browser tests](#browser-tests)) |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run build` | Production build |
| `npm run db:generate` | Generate a Drizzle migration from schema changes |
| `npm run db:migrate:local` | Apply migrations to the local D1 database |
| `npm run db:migrate` | Apply migrations to the remote D1 database, using `wrangler.deploy.jsonc` |
| `npm run db:backfill:dates` | Fill structured date columns for events written before migration 0007 (add `-- --remote` for the deployed database) |
| `npm run db:backfill:evidence` | Move sources, repositories and citations a tree kept as retained GEDCOM lines (imported before migration 0020) into records; add `-- --remote` for the deployed database. Run it after the migration |
| `npm run db:backfill:notes` | Move notes a tree kept as retained GEDCOM lines, in extra lines, or in a fact's `notes` column (imported before migration 0021) into note records; add `-- --remote` for the deployed database. Run it after migration 0021 **and after** `db:backfill:evidence` |
| `node scripts/deploy-config.mjs` | Check that `wrangler.deploy.jsonc` exists and agrees with `wrangler.jsonc` on the fields the build reads (`deploy` runs it first) |
| `npm run deploy` | Check the deploy config, migrate, build and deploy the Worker using `wrangler.deploy.jsonc` |

### Deploy configuration

The tracked `wrangler.jsonc` is safe for development: it has every binding, a placeholder D1 id and
none of the owner's values (team domain, email sender, route or workers.dev setting). Remote commands (`db:migrate`,
`deploy`, and the backfill scripts with `--remote`) use a generated, git-ignored
`wrangler.deploy.jsonc` instead, which is the tracked file plus the real ids, how the Worker is served (`workers_dev` or a custom-domain route) and the vars.
[`wrangler.deploy.example.jsonc`](wrangler.deploy.example.jsonc) shows its shape. Without it those
commands stop and say to run `npm run setup`.

The build still reads the tracked file. `adapter-cloudflare` takes only `main` and `assets` from it, so
`deploy` fails if the deploy file differs on those fields. Keep `main` at the adapter default and
pass `workers/entry.ts` to `wrangler deploy` directly.

Local state is keyed by the D1 id, so the placeholder id starts a fresh local database: run
`npm run db:migrate:local` once after pulling this change.

### Browser tests

The Playwright suite in `e2e/` drives the real UI, including keyboard-only flows, delete with an
impact summary, undo, a forced 409 conflict, the Phase 1 scenarios built through the editor,
axe accessibility checks and a phone-sized run. It is outside `npm test` and the commit gate.

```sh
npm run db:migrate:local      # the dev database must be migrated
npm run test:e2e
```

Playwright starts its own dev server on port 5179 (or reuses one already running there) and uses
your installed Google Chrome, so no browser download is needed. Without Chrome, run
`npx playwright install chromium` and remove `channel: 'chrome'` from `playwright.config.ts`.

On a cold start (after clearing `node_modules/.vite`) the dev server's first request often answers
`500 GET /`, logging `TypeError: Cannot read properties of null (reading 'function')` from
`+layout.svelte`. It is not caused by the app: the log shows Vite's forced dependency
re-optimisation followed by an SSR "program reload" while that first request is rendering. Measured
over 30 cold starts each (2026-09-30), the first request failed 12 times on `main` (S3) and 14 times
on the S4 branch, and the second request always succeeded. It never happens on a warm cache or in the
production build. Ignore it if the specs pass.

Every spec creates a uniquely named tree through the API and deletes it afterwards, so "The
Simpsons" and any other data in your local database are left alone. Stop `npm run dev` before
`npm test`, which shares local D1 state with it.

### Addresses

| Address | Shows |
|---|---|
| `/` | Opens the latest tree; the old `/?tree=…&focus=…` form redirects to the tree with the rest of the query kept |
| `/trees/:id?focus=&up=&down=&siblings=&step=&exp=&types=&side=&origins=&mode=` | The focus-centred tree; the view is in the address, so reload, Back and shared links restore it. `mode` is `flat`, `layers` or `floors` (ADR-030); a link without it opens in the viewer's default view, then the tree's, then flat |
| `/trees/:id/people/:personId` | A person: names, facts (add, edit, remove, reorder), family, evidence, media, history |
| `/trees/:id/people/:personId/pedigree`, `/descendants`, `/fan`, `/hourglass` | Charts centred on a person, with a text outline |
| `/trees/:id/unions/:unionId` | A partnership: partners, events, children, chronology, evidence, warnings |
| `/trees/:id/search?q=&place=&from=&to=` | Ranked search over names, XREFs, places and years, saying why each person matched |
| `/trees/:id/people`, `/unions`, `/surnames` | Server-paged lists |
| `/trees/:id/relationship?from=&to=` | Every route between two people |
| `/trees/:id/places`, `/place?name=` | Places named by facts, and the facts at one place |
| `/trees/:id/sources`, `/sources/:sourceId` | Sources the viewer may see, and what each one supports |
| `/trees/:id/notes`, `/notes/:noteId` | Shared notes, and where each one is used |
| `/trees/:id/tasks` | Research tasks, open by default, with filters |
| `/trees/:id/quality` | The data-quality report, with dismissals; managers also see privacy leaks |
| `/trees/:id/members`, `/privacy` | Members and invitations; the tree's privacy settings (managers) |

Person ids from an import look like `<treeId>:@I1@`; build links with `encodeURIComponent`. The tree
reads a bounded window (`GET /api/trees/:id/graph?focus=…`) rather than the whole tree; see
[docs/query-plans.md](./docs/query-plans.md) and ADR-011.

### Change history and undo

Every change to a tree (relationship edits, deaths, partnership edits, person create, edit and
delete, and removals) is written to an append-only change log in the same atomic batch as the
change. Each successful change shows a toast with **Undo**. Undo reverts your own most recent
change in the tree, and is refused with a reason if someone else has since changed the same
records. See ADR-007 in [docs/decisions.md](./docs/decisions.md).

### Duplicate families and merging partnerships

A dirty GEDCOM can carry one family several times ([docs/gedcom-data/The_Simpsons.ged](./docs/gedcom-data/The_Simpsons.ged) does;
never seed from it). The import preview lists **Duplicate families** (same two partners, identical
facts, no disagreement about a child) with a default-on option to merge them, and **Possible
duplicates** for review only. A merged family keeps every original XREF as an alias, and export
writes it back as `REFN` records.

For data already in a tree, choose **Merge duplicate partnerships…** from a partnership's menu or
**Merge…** in the person drawer. The dialog lists exactly which links, events and partnerships move
or go. If the partnerships record different facts, such as two marriage dates, you must choose
which to keep. A merge is logged and can be undone. Repeated partnerships between the same pair are
labelled "1st partnership", "2nd partnership", with dates. See ADR-008 and ADR-009 in
[docs/decisions.md](./docs/decisions.md).

Migrations must be backwards compatible (expand and contract). `wrangler rollback` restores
code, never schema.
