# Epoch

A private family-tree application for one owner and invited collaborators, inspired by webtrees
capabilities. Built with Svelte 5, SvelteKit 3, Cloudflare Workers, D1 (Drizzle), R2, Queues and
Workflows. See [CLAUDE.md](./CLAUDE.md) for architecture and conventions and
[docs/roadmap.md](./docs/roadmap.md) for direction.

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

This imports [docs/The_Simpsons_clean.ged](./docs/The_Simpsons_clean.ged) as a tree named "The
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
| `npm run db:migrate` | Apply migrations to the remote D1 database |
| `npm run db:backfill:dates` | Fill structured date columns for events written before migration 0007 (add `-- --remote` for the deployed database) |
| `npm run deploy` | Migrate, build and deploy the Worker |

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
| `/trees/:id?focus=&up=&down=&siblings=&step=&exp=&types=` | The focus-centred tree; the view is in the address, so reload, Back and shared links restore it |
| `/trees/:id/people/:personId` | A person: names, facts (add, edit, remove, reorder), family, history |
| `/trees/:id/unions/:unionId` | A partnership: partners, events, children, chronology, warnings |

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

A dirty GEDCOM can carry one family several times ([docs/The_Simpsons.ged](./docs/The_Simpsons.ged) does;
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
