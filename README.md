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

The app runs at <http://localhost:5173>. Without `npm run db:migrate:local`, requests fail with
`no such table: users`.

### Dev identity

Identity normally comes from Cloudflare Access. For local development, `.dev.vars` sets
`ACCESS_BYPASS_DEV=true`, which lets requests without a token act as a local developer
(`dev-local-user`, `developer@epoch.local`). Override the identity per request with the
`x-dev-user-sub`, `x-dev-user-email` and `x-dev-user-name` headers.

The bypass is opt-in only. It is never inferred from `NODE_ENV`, and without the flag every
request without a valid Access token is rejected with 401. Never set the flag in a deployed
environment. `.dev.vars` is git-ignored.

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
| `npm test` | Run all Vitest suites once (unit and real-D1 service tests) |
| `npm run test:e2e` | Run the Playwright browser tests (see [Browser tests](#browser-tests)) |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run build` | Production build |
| `npm run db:generate` | Generate a Drizzle migration from schema changes |
| `npm run db:migrate:local` | Apply migrations to the local D1 database |
| `npm run db:migrate` | Apply migrations to the remote D1 database |
| `npm run deploy` | Migrate, build and deploy the Worker |

### Browser tests

The Playwright suite in `e2e/` drives the real UI, including keyboard-only flows, delete with an
impact summary, undo and a forced 409 conflict. It is outside `npm test` and the commit gate.

```sh
npm run db:migrate:local      # the dev database must be migrated
npm run test:e2e
```

Playwright starts its own dev server on port 5179 (or reuses one already running there) and uses
your installed Google Chrome, so no browser download is needed. Without Chrome, run
`npx playwright install chromium` and remove `channel: 'chrome'` from `playwright.config.ts`.

Every spec creates a uniquely named tree through the API and deletes it afterwards, so "The
Simpsons" and any other data in your local database are left alone. Stop `npm run dev` before
`npm test`, which shares local D1 state with it.

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
