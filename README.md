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
| `npm test` | Run all Vitest suites once |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run build` | Production build |
| `npm run db:generate` | Generate a Drizzle migration from schema changes |
| `npm run db:migrate:local` | Apply migrations to the local D1 database |
| `npm run db:migrate` | Apply migrations to the remote D1 database |
| `npm run deploy` | Migrate, build and deploy the Worker |

Migrations must be backwards compatible (expand and contract). `wrangler rollback` restores
code, never schema.
