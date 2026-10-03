# Prompt: architecture review Phases B to E (cull, server structure, types, client)

Hand this whole file to a fresh session.

---

You are working on Epoch (SvelteKit 3 / Svelte 5 / Cloudflare Workers + D1), a private
family-tree app. Your job is the behaviour-preserving clean-up planned in
`docs/architecture-review.md`, Phases B to E. Phase A (prettier, eslint, knip, `npm run lint`) is
done.

## Read first

- `AGENTS.md`. Follow it exactly: layering, naming, comments explain why, colocated tests, small
  Conventional Commits, and the commit trailer it asks for.
- `docs/architecture-review.md`, all of it. It is the specification. Its action plan (Phases B to
  E) is your work list.
- `docs/decisions.md`: ADR-006 (layering), ADR-015 (privacy), ADR-016 (members), ADR-022 to
  ADR-026. ADR-026 changed the auth hook and the client's 401 handling after the review was
  written.
- `src/routes/privacy-matrix.test.ts`. Every endpoint and load is listed there; it must stay
  accurate as routes move.
- `knip.jsonc`, `eslint.config.js`, `package.json` scripts and `e2e/support.ts`.

Create branch `refactor/architecture-b-e` from the latest `main`. The repo needs Node ≥ 24.

## The review is older than the code: verify before you act

The review was written at `e8adc88` (S12). Since then S13 (quality), S14 (person merge), S15a
(evidence round trip), the boolean renames and ADR-026 (one Access application on `/login`) have
landed. So:

- **Line numbers are stale.** Find each item by name. Before deleting anything, confirm it is
  still unreferenced: knip's output, `grep`, and `npm run check`.
- **Some items have moved or are partly done.** For example, B7's test-harness note was already
  corrected in `fed638c`. If an item is already done, record it as done and move on.
- **New code may share the old problems.** The S13, S14 and S15a endpoints (quality, person merge
  and others) are in scope for C2 to C5, and in the GEDCOM work too.
- **`hooks.server.ts` changed under ADR-026.** It now:
  - decides signed-out redirects through `public-routes.ts`;
  - honours the dev bypass only on a local hostname;
  - sends an invalid token to `/login`.

  C12 (`resolveUser`) must keep all of that exactly.
- **Two behaviours the client now depends on must survive the API refactor:**
  - an unauthenticated API call answers **401** with `{ "error": "Authentication required" }`
    (`tree-api.ts` `call` restarts sign-in on a 401 in the browser);
  - a stale version answers 409 with `details.reason = 'STALE_VERSION'` and `details.current`.

  `treeHandler` must produce exactly these. Add unit tests for both.

If something in the review turns out to be wrong, or no longer worth doing, do not force it.
Skip it and say why in the status table (below).

## Rules for the whole job

- **No behaviour change**, apart from C8, which is a deliberate correctness fix.
  - No API response shape changes except the D4 path move. The UI must look and work the same.
  - E3 (shared CSS classes) may change pixels only by accident. Compare before and after.
- **One step from the action plan is one commit, or a few**, each independently revertible, with
  the "Verify" column run before committing. Don't batch steps.
- **Gate before every push:** `npm run check`, `npm run lint` and `npm test`.
  - Push after each phase at minimum, and whenever you finish a resource group in C2 to C5.
  - `union-merge.test.ts` and `union-page-service.test.ts` have hit the 5-second timeout in slow
    containers on an untouched `main`. If only those time out, rerun them alone and note it. Do
    not raise timeouts or skip tests.
- **e2e** (`npm run test:e2e`) is outside the push gate, but the review names the specs to run for
  several steps. Run them for those steps.
  - `playwright.config.ts` uses the Chrome channel. If no Chrome is installed, point Playwright at
    an installed Chromium through `executablePath` *locally, without committing that change*,
    rather than downloading browsers.
  - If e2e can't run at all in your environment, say so in the status table for each affected step
    and lean harder on unit tests.
- **Migrations:** none are expected. If one seems needed, stop and explain instead.
- **`privacy-matrix.test.ts`** must stay green after every route move or deletion. Keep each
  endpoint's `kind` and `covers` honest; don't just rename keys.

## Order and notes per phase

### Phase B: cull dead code

- Steps B1 to B7 as written.
- B7: also archive `docs/access-single-app-prompt.md`, and this prompt once you are done.
  `docs/improvement-plan.md` still links `neutral-graph-layout.ts`; fix it, or mark that section
  historical.
- **When B is done, delete the `rules` block in `knip.jsonc`** (its comment says so), so new dead
  code fails `npm run lint` from then on. Make that its own commit, after the knip report is clean.

### Phase C: server structure

Order matters:

1. **C1** first: `treeHandler` in `src/lib/server/http/handler.ts`, with tests for:
   - 401 (shape above);
   - a 400 for a missing param;
   - a 500 for a missing binding;
   - body and query parsing;
   - `expectedVersion`;
   - `status: 201`;
   - errors routed through `errorResponse`.
2. **C2 to C5** are one commit per resource group. Group the S13 to S15a endpoints with their
   nearest group; don't make a sixth commit for them.
3. **C6 and C7** as written. The workflow's hand-written membership check is part of C6.
4. **C8** is the correctness fix: import authorizes with `requireTreeAction('tree:import')`
   instead of loading the tree. Its test must fail before the fix and pass after.
   - One test: a viewer is refused.
   - Another test: proves the check doesn't read the tree's rows, for example by counting queries
     or using a tree whose rows would throw if read.
5. **C9 to C11**: the GEDCOM split, in the review's proposed layout.
   - `neutral-importer.ts` and `importer.ts` both exist now; decide which parts are parser,
     repository and service, and say so in the commit body.
   - The R2 export helper and the filename rule are unified in C11: pick one filename rule and
     note the change of name for whichever path loses.
   - All GEDCOM round-trip tests, including `evidence-roundtrip.test.ts`, must pass unchanged.
6. **C12**: `resolveUser`, keeping every ADR-026 behaviour listed above. `access.test.ts` and
   `public-routes.test.ts` must pass unchanged.

### Phase D: model and types

- D1 to D5 as written. D2's verification is a grep; include its output in the commit body.
- **D4 moves `/individuals` endpoints to `/people`.** Update:
  - the client;
  - `e2e/support.ts`;
  - the e2e specs;
  - the privacy matrix.

  There are no external API clients, so no compatibility alias is needed.
- **D5:** after splitting out `PersonService`, rename `GenealogyService` to `TreeService` only if
  that's all it then holds.

### Phase E: client succinctness

- E1 to E8 as written. E8 is a review. Split `RelationshipModal` only if it is still large after
  E4, and record the decision either way.
- Preserve accessibility: the `accessibility.spec.ts` axe checks must still pass after E2, E3, E5
  and E6.
- E6 must keep keyboard navigation identical. `keyboard.spec.ts` and `controls.spec.ts` are the
  proof.

## Keep a status table so the work can be resumed

Add a "Status" column (or a status table under "Action plan") to `docs/architecture-review.md`.
For every step record:

- done (with the commit),
- skipped (with why), or
- already done before this branch.

Commit it as you go, at least once per phase. If you run out of context or time part way, the
next session resumes from that table. Stop at a clean phase or group boundary, never mid-step, and
make sure everything is pushed.

At the end, update the review's "Expected outcome" with the measured numbers: lines removed from
the API layer, from client pages and components, and in total; dependencies dropped. Use `git diff
--stat main...` and `cloc` or `wc -l` as you see fit.

## Out of scope

- §2.8 (moving loads to `+page.server.ts`). The review recommends keeping the current shape.
- New features, migrations, dependency upgrades beyond B6, and anything the review does not list.
  If you spot a real bug along the way, fix it in its own `fix:` commit with a test, and mention
  it.

## Done when

- Every step in Phases B to E is done or deliberately skipped, with the status table saying which.
- knip's `rules` block is gone and `npm run lint` passes with it removed.
- The gate is green, and e2e has been run for the steps that name it (or its absence is noted).
- Everything is pushed to `refactor/architecture-b-e`, with a short summary covering:
  - per-phase results;
  - the C8 fix;
  - the export filename decision;
  - anything skipped and why.

Do not open a pull request or merge to `main` unless asked.
