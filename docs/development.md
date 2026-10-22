# Developing Epoch

Notes for working on Epoch itself. For features, see the [README](../README.md). For installation, see
[INSTALL.md](../INSTALL.md).

- [AGENTS.md](../AGENTS.md): architecture, layering and code conventions.
- [architecture.md](./architecture.md): direction, layering, data model and authorization.
- [backlog.md](./backlog.md): open fixes and proposed additions.
- [decisions.md](./decisions.md): architecture decision records (ADRs).

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run check` | Sync SvelteKit types and run `svelte-check` |
| `npm run lint` | Format check, ESLint and knip; the push gate |
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
| `npm run db:backfill:fact-details` | Move the event details a tree kept as retained GEDCOM lines (ADDR, TYPE, AGNC, RELI, PHON, EMAIL, FAX, WWW; imported before migration 0031) into the fact's columns; add `-- --remote` for the deployed database. Run it after `db:backfill:evidence` and `db:backfill:notes`, **immediately after the deploy that carries migration 0031**: until it runs, a merge-mode re-import duplicates facts that have an ADDR, and filling an empty Address in the editor leaves two ADDR lines on export. It cannot restore PLAC sub-lines (MAP, FORM, ...) that earlier imports dropped; a replace-mode re-import of the file does |
| `node scripts/deploy-config.mjs` | Write `wrangler.deploy.jsonc` from `EPOCH_DEPLOY_VALUES` if that is set, then check that the file exists and agrees with `wrangler.jsonc` on the fields the build reads |
| `npm run build:worker` | Run the check above, then build (the Workers Builds build command) |
| `npm run deploy:worker` | Migrate and deploy using `wrangler.deploy.jsonc`, without building (the Workers Builds deploy command) |
| `npm run deploy` | `build:worker` then `deploy:worker`, for deploying from your own machine |

## Database and migrations

The migrations in `drizzle/` are the only schema source. Without `npm run db:migrate:local` (or
after pulling new migrations) every request fails with a 503 that says to run it, rather than a
`no such table` error. The check compares Wrangler's `d1_migrations` record with the migration
journal, so it also catches a partly applied set.

Migrations must be backwards compatible (expand and contract). `wrangler rollback` restores code,
never schema.

## Deploy configuration

The tracked `wrangler.jsonc` is safe for development and contains none of an install's values. It
has every binding and names the D1 database, with no id. Remote commands (`db:migrate`, `deploy`,
and the backfill scripts with `--remote`) use `wrangler.deploy.jsonc` instead. That file is the
tracked one plus this install's Worker name, how the Worker is served (`workers_dev` or a
custom-domain route), the vars and the sender address.

`wrangler.deploy.jsonc` is git-ignored (ADR-043). It is written in one of two ways:

- **On your machine:** `./setup` writes it and rewrites it on every run, showing the diff. To write
  it by hand, copy `wrangler.jsonc` and fill in your values.
- **On Workers Builds:** `npm run build:worker` writes it from the `EPOCH_DEPLOY_VALUES` build
  variable, which `./setup` (or `./setup builds`) sets.

Without the file or the variable, remote commands stop and say to run setup.

The tracked `wrangler.jsonc` carries one var of its own, `EPOCH_SOURCE_URL`: the repository every
page's "Source code (AGPL)" link points to. It belongs to the fork rather than the install, so it
lives in the tracked file, and the generator keeps tracked vars. The code falls back to the upstream
repository when it is unset or blank, so a deploy file written before the var existed still gets a
link.

The link also names the commit the running code was built from, such as `· 539a424`, so a visitor
can find its exact source. `vite.config.ts` bakes it in at build time: from Workers Builds'
`WORKERS_CI_COMMIT_SHA`, else from git, with `-dirty` when a local build or `npm run deploy` had
uncommitted changes. A build with neither shows no commit. The dev server reads it once at start.

There is no D1 id anywhere. Wrangler looks the database up by `database_name` on deploy and on
every remote `d1` command, so a renamed database has to be renamed in config too. Migrations run
before the deploy, so a name that matches no database fails the migration instead of letting the
deploy create an empty database.

The build still reads the tracked file. `adapter-cloudflare` takes only `main` and `assets` from it,
so the check fails if the deploy file differs on those fields. Keep `main` at the adapter default and
pass `workers/entry.ts` to `wrangler deploy` directly.

Local D1 state is stored under the binding name `DB`, because there is no id. After pulling the
change that removed the placeholder id, run `npm run db:migrate:local` (and `npm run seed`) once.

The design of the setup tool, and the checks that still need a real account
(`./setup spike`), are listed in [backlog.md](./backlog.md#setup-tool-npm-run-setup).

## Identity and sign-in

Epoch uses **one** Cloudflare Access application, covering only `<host>/login`. Every other path is
plain Worker traffic and the Worker is the gate: a signed-out page load is redirected to
`/welcome?next=…`, whose "Sign in" button goes to `/login?next=…`. Access authenticates the visitor
there and sets the `CF_Authorization` cookie, then `/login` redirects to `next` (ADR-026).

Getting past Access is not enough to use Epoch (ADR-034). The Worker admits only the install owner
(the `install_meta` row), people who hold a membership in any tree, and people with an unexpired
invitation, which is taken up on that same request. Anyone else is sent to
`/welcome?reason=not-invited`; API calls from them get a 403. Until the setup tool writes
`install_meta`, an install has no owner and admits only members and invitees.

The dev bypass (`ACCESS_BYPASS_DEV=true`) is never inferred from `NODE_ENV`, and it is compiled
out of production builds (`import.meta.env.DEV`, which Vite takes from the build mode, so do not
build with `NODE_ENV=development`), so it works under `npm run dev` only, not under
`npm run preview` or a built Worker. Without the flag every
request without a valid Access token is rejected with 401. While the local database has no
`install_meta` row, the default developer (`dev-local-user`) stands in for the install owner, so a
fresh database works without setup. Add an `install_meta` row to try the not-invited page locally.

### Using the Google picture as the avatar (manual Zero Trust step)

Access leaves the Google `picture` out of its token unless you ask for it. In the Zero Trust
dashboard, go to **Integrations > Identity providers**, edit the Google provider, and under
**OIDC Claims** add `picture`. Access then puts it in the token's `custom` claim (best effort, about
1 KB). Without this step nobody has a Google picture to import and everyone starts on initials; they
can still upload one. Only `https://*.googleusercontent.com` addresses are fetched (ADR-070), and the
dev bypass never has a picture.

After changing the sign-in flow, verify on a real deploy that signing in returns you to the page you
wanted, and that API calls after sign-in authenticate from the cookie alone.

## A tree on its own subdomain

Add `EPOCH_TREE_HOST_ZONE=localhost` to `.dev.vars`, restart `npm run dev`, and tick "Also open this
tree at …" in a tree's rename dialog. The tree is then served at `http://<slug>.localhost:<port>`:
browsers resolve `*.localhost` to this machine, and the dev bypass accepts it (ADR-057). A label
that names no tree, or a tree with the box unticked, answers 404.

On Cloudflare, `./setup subdomains` sets up the wildcard DNS record, the exclusion routes, the
Access destination and the vars (INSTALL.md, "Serving trees on their own subdomains"). Its code is
`tools/setup/steps/subdomains.ts`. The settings live in the manifest's `subdomains` and in
`DeployValues`, so `generateDeployConfig` writes them on every setup run and every Workers Builds
deploy. Never add these vars or routes to `wrangler.deploy.jsonc` by hand: the next push drops them.

## Addresses

| Address | Shows |
|---|---|
| `/` | Opens the latest tree; the old `/?tree=…&focus=…` form redirects to the tree with the rest of the query kept |
| `/trees/:id?focus=&up=&down=&siblings=&step=&exp=&types=&side=&origins=&mode=` | The focus-centred tree; the view is in the address, so reload, Back and shared links restore it. `mode` is `flat`, `rings`, `poincare`, `ribbons` or `orrery` (ADR-032, ADR-047); a link without it opens in the viewer's default view, then the tree's, then flat |
| `/trees/:id/people/:personId` | A person: names, facts, family, evidence, media, history |
| `/trees/:id/people/:personId/pedigree`, `/descendants`, `/fan`, `/hourglass` | Charts centred on a person, with a text outline |
| `/trees/:id/unions/:unionId` | A partnership: partners, events, children, chronology, evidence, warnings |
| `/trees/:id/search?q=&place=&from=&to=` | Ranked search over names, XREFs, places and years |
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
[query-plans.md](./query-plans.md) and ADR-011.

## Change history, undo and merges

Every change to a tree is written to an append-only change log in the same atomic batch as the
change (ADR-007). Undo is refused when someone else has since changed the same records.

Duplicate-family detection on import and the merge-partnerships dialog are described in ADR-008 and
ADR-009.

## Test data

Test fixtures live in `test/data/` and contain only fictional or public people. Never commit a real
family's GEDCOM, or real people's names in tests, placeholders or docs.

| File | Used for |
|---|---|
| `The Simpsons.ged` | `npm run seed`, and the person-page, partnership-page and focus-window service tests |
| `The Windsors.ged` | A larger public tree (the webtrees demo) with sources, places and media: date import, the name round trip and `e2e/routes.spec.ts` |
| `The Simpsons duplicate families.ged` | Deliberately repeats families, for the duplicate-family import and merge tests (unit and e2e); never seed from it |
| `The Simpsons names.ged` | Name structures: birth and married names, prefix, nickname, particle, suffix, `_MARNM` |

The layout tests read captured graphs in `src/lib/tree-layout/fixtures/` instead of importing a
file.

## Browser tests

The Playwright suite in `e2e/` drives the real UI, including keyboard-only flows, delete with an
impact summary, undo, a forced 409 conflict, the Phase 1 scenarios built through the editor, axe
accessibility checks and a phone-sized run. It is outside `npm test` and the commit gate.

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
on the S4 branch, and the second request always succeeded. It never happens on a warm cache or in
the production build. Ignore it if the specs pass.

Every spec creates a uniquely named tree through the API and deletes it afterwards, so "The Simpsons"
and any other data in your local database are left alone. Stop `npm run dev` before `npm test`,
which shares local D1 state with it.

## Brand assets

The icons are SVGs in `static/` and `static/brand/`. After changing one, run `npm run brand:render`
to regenerate the PNGs and `favicon.ico`, and commit the output. Set `CHROMIUM_PATH` if the
installed Chromium is not the build Playwright expects.
