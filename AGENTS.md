# AGENTS.md / CLAUDE.md

This file provides guidance to LLMs when working with code in this repository.

## Project status
This repository is an initial proof of concept implementation of webtrees.net using more contemporary frameworks, particularly svelte, sveltekit and cloudflare workers, D1, queues and other resources.

## Architecture

Epoch is a private, single-owner family-tree application with invited collaborators, inspired by
webtrees capabilities but not its screens or implementation. Identity comes from Cloudflare Access;
Epoch stores roles and permissions. The canonical model is GEDCOM-aware and must round-trip every
supported structure without loss; unsupported imported structures are retained for later export.

**Stack:** Svelte 5 / SvelteKit 3, Cloudflare Workers, D1 (Drizzle ORM), R2, Queues, and Workflows.

**Layering** (enforced — routes never touch the database directly):

1. **Domain** (`src/lib/server/domain/`) — pure models, command interfaces, typed errors
   (`DomainError`, `UnauthorizedError`, `NotFoundError`, `ConcurrencyConflictError`,
   `ValidationError`), and business invariants.
2. **Persistence** (`src/lib/server/repositories/`) — D1 implementations with optimistic
   concurrency (`version` columns) and audit metadata.
3. **Service** (`src/lib/server/services/`) — coordinate domain commands, enforce tree
   authorization, return DTOs.
4. **Transport/UI** (`src/routes/`, `src/lib/components/`) — SvelteKit hooks, API endpoints, and
   views. Handlers only parse input, invoke services, and format responses.

**Data model direction** (Phase 1 target — the current gendered schema is being replaced, not
extended):

- `person` — identity container, privacy/living-state inputs, record metadata.
- `person_name` — multiple names, types, components, preferred display name.
- `union` — a partnership/family episode, never inferred to mean marriage.
- `union_partner` — ordered participants with neutral roles; GEDCOM spouse-role metadata is an
  interchange concern.
- `parent_child` — a direct assertion between two people with type (`biological`, `adoptive`,
  `foster`, `guardian`, `unknown/other`), optional union context, status, dates, notes, evidence.
- `event` — typed, repeatable facts for a person or union.
- `date_value` — original GEDCOM text plus parsed lower/upper bounds, precision, calendar, and
  qualifier; never converts `1900` or `ABT 1900` into a fabricated exact day.

Step relationships are derived from a parent's union; widowhood from partner death and union
history. Death never deletes or rewrites a union. Multiple unions between the same people remain
distinct.

**Cloudflare resources** (`wrangler.jsonc`): D1 (`DB`), R2 (`MEDIA_BUCKET`), Queue
(`GEDCOM_IMPORT_QUEUE`), Workflow (`GedcomExportWorkflow`). Queues/Workflows are reserved for large
or retryable import/export/media jobs; Durable Objects are deferred until a demonstrated
coordination need exists.

**Authorization**: Cloudflare Access JWT validated at the Worker (issuer, audience, rotating JWKS),
users upserted by stable `sub`. Tree roles (`owner` > `manager` > `editor` > `contributor` >
`viewer`) gate actions via `isActionAllowed`; every endpoint denies by default.


## Important Notes

These are the highest-value things to remember and are all established in the plan:

1. **Do not point `wrangler.jsonc`'s `main` at the custom Worker entry.** The adapter reads that
   field and overwrites whatever it names with the plain generated fetch handler on every build.
   Leave `main` at the adapter default; pass `workers/entry.ts` positionally in the deploy/preview
   scripts.
2. **Keep the custom entry at `workers/entry.ts`, outside `src/`.** It imports a file that only
   exists after `vite build` runs; under `src/` it would break a fresh-clone typecheck.
3. **Use `nodeLinker: node-modules`, never Plug'n'Play.** PnP breaks Vite, Wrangler, and several
   tools in this stack.

## Conventions

- **Comments explain why, never what.** The highest-value comment explains why the obvious approach
  was *not* taken. A stale comment is a bug report.
- **Types are the documentation.** TSDoc (not JSDoc) only where it adds something the type cannot
  say (units, ranges, idempotency, cost).
- **No TypeScript `enum`.** Use `as const` objects with derived union types. Names carry their units
  (`SESSION_TTL_SECONDS`, `MAX_PLUGIN_BUNDLE_BYTES`).
- **Every boolean starts with one of:** `is has should can did will was are allow needs`. Enforced
  by `@typescript-eslint/naming-convention` (type-aware). Apply the same by hand to D1 columns.
- **Colocate `*.test.ts` beside the source.** Vitest for units/integration under
  `@cloudflare/vitest-pool-workers` (real D1/R2/KV via Miniflare); Playwright for e2e, outside the
  push gate.
- **Prettier:** tabs, single quotes, semi, 100 cols, with `prettier-plugin-svelte` and
  `prettier-plugin-tailwindcss`.
- **Svelte components:** declare a `Props` interface with TSDoc per prop, destructure from
  `$props()`. No reaching into globals/stores not received.

## Commands

Migrations must be **backwards compatible** (expand-and-contract): adding a nullable/defaulted
column in its own migration deployed before code reads it; removing means stop reading, then drop
later. `wrangler rollback` restores code, never schema.

## Commit discipline

- Commit frequently in small, feature-focused batches so any single problem can be rolled back
  granularly. Never dump many unrelated files into one commit.
- Commit messages follow the Conventional Commits style enforced by the repo's git-commit skill
  (see `.agents/skills/git-commit/SKILL.md`): `<type>[scope]: <description>`, imperative mood,
  under 72 chars, one logical change per commit.
- Every commit made by an agent carries a `Co-Author: <model> <noreply@github.com>` trailer, where
  `<model>` is the committing agent's model identifier (e.g.
  `Co-Author: claude-sonnet-4-5 <noreply@github.com>`). Commits made directly by the human operator
  omit the trailer.
