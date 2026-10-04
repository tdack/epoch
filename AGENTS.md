# AGENTS.md / CLAUDE.md

This file provides guidance to LLMs when working with code in this repository.

## Project status
This repository is an initial proof of concept implementation of webtrees.net using more contemporary frameworks, particularly svelte, sveltekit and cloudflare workers, D1, queues and other resources.

Phase status lives only in the table in `docs/roadmap.md`; slice status (S0 … S16) lives in the
delivery-slices table and status sections of `docs/improvement-plan.md`. Each phase document carries
its own status against its exit criteria. Update those, not this file, when a slice lands.

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

**Data model** (the neutral model is the single source of truth; the gendered
legacy `families`/`family_children` tables have been expunged):

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
  by `@typescript-eslint/naming-convention` (type-aware, in `eslint.config.js`) for variables,
  parameters and declared properties; object-literal options of platform APIs are exempt. It cannot
  see D1 columns, so apply the same by hand there.
- **Colocate `*.test.ts` beside the source.** Vitest for units/integration; service
  and repository tests get a real D1 from wrangler's `getPlatformProxy` (`server/testing/d1.ts`);
  Playwright for e2e, outside the push gate.
- **Prettier** (`.prettierrc`): tabs, single quotes, semi, 100 cols, no trailing commas, with
  `prettier-plugin-svelte` and `prettier-plugin-tailwindcss`. `npm run format` writes, `npm run
  format:check` verifies. `.git-blame-ignore-revs` hides the one-off reformat; run `git config
  blame.ignoreRevsFile .git-blame-ignore-revs` once per clone.
- **ESLint** (flat config; typescript-eslint and eslint-plugin-svelte) and **knip** (`knip.jsonc`,
  unused files, exports and dependencies; findings fail `npm run lint`).
  `npm run lint` runs the format check, ESLint and knip, and is the push gate. The choice of tools
  and what would change it is ADR-025.
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
- Every commit made by an agent ends with a `Co-Authored-By: <model> <noreply@<provider>>` trailer:
  `<model>` is the committing agent's model name, and `<provider>` is its vendor's domain. For
  example:
  - `Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>`
  - `Co-Authored-By: Gemini Flash <noreply@google.com>`
  - `Co-Authored-By: GPT-5 <noreply@openai.com>`

  Spell the key `Co-Authored-By` (GitHub and GitLab match it case-insensitively); tools ignore
  any other spelling, such as `Co-Author`. If the agent's harness supplies its own trailer of this
  form, keep it rather than adding a second. Commits made directly by the human operator omit the
  trailer.
