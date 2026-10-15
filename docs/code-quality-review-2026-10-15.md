# Code quality review, 2026-10-15

A review of architecture, component size, duplication, type safety, documentation and edge
performance at commit `40e6beb` (about 75,000 lines of non-test TypeScript and Svelte, 92 API
endpoints, 32 loaders). Items already tracked in [backlog.md](./backlog.md) are named as such rather
than raised again.

## What is already strong

These were checked, not assumed, and should be kept:

- **The handler factory.** `treeHandler` and `apiHandler` (`src/lib/server/http/handler.ts`) own the
  401, the visitor guard, slug resolution, zod parsing and error mapping. Endpoints are 10 to 40
  lines and only parse, call a service and return. Deny-by-default is enforced and tested.
- **Layering on the server.** No route touches D1; no client module imports `#lib/server`. zod,
  drizzle and fflate stay server-only.
- **Bundle discipline.** three.js is imported only by the `*-scene.ts` modules, and each WebGL view
  loads its scene with `import()`, so only someone who opens a 3D view pays for it.
- **Reads are parallel.** The read services and loaders use `Promise.all` (for example
  `trees/[id]/+layout.ts`, `note-read-service.ts`, `member-service.ts`); no accidental waterfalls
  were found in services.
- **Comments explain why.** About 14% of non-test lines are comments, nearly all rationale, edge
  cases or ADR references. There are no TODO or FIXME markers and almost no "what" comments.
- **Explicit types.** 603 of 615 exported functions declare their return type.

## Findings, most important first

### [ARCHITECTURE] Every write reads the whole tree, and the backlog does not track it

- **Location:** `src/lib/server/services/mutation-runner.ts` (`planned`, `run`),
  `src/lib/server/repositories/change-store.ts` (`loadRows`)
- **Observation:** Every mutation, preview and merge loads a full `TreeRows` snapshot: 14 parallel
  `SELECT … WHERE tree_id = ?` queries over individuals, names, events, unions, citations, notes,
  tasks and more. It is called from 11 places. On a 10,000-person tree that is tens of thousands of
  D1 rows read and a large in-memory object per edit, against the Worker's 128 MB limit and D1's
  per-row billing. `docs/query-plans.md` says "It is the next place a large tree will hurt", but
  `backlog.md` does not list it, and the project rule is that open fixes live only in the backlog.
- **Refactoring strategy:** Do not redesign yet. Add a backlog item, then measure rows read and
  peak memory for one fact edit on the 5,324-person corpus. If it hurts, the planner already works
  on a snapshot, so a scoped loader (the records a command names, plus their one-hop neighbours for
  cascades) can replace `loadRows` per command kind without changing the pure `buildPlanOps`.
- **Current code snippet:**
  ```typescript
  const scope = await this.scopeFor(treeId, context, 'record:create');
  const snapshot = rows ?? (await this.store.loadRows(treeId));
  const ops = this.planFor(treeId, snapshot, change.commands, scope);
  ```
- **Refactored code snippet:**
  ```typescript
  // backlog.md, "Search, lists and performance"
  - **Every write reads the whole tree.** `ChangeStore.loadRows` runs 14 queries per mutation,
    preview and merge (query-plans.md, "Writes still read the whole tree"). Measure rows read and
    peak memory for a fact edit on the 5,324-person corpus before choosing a scoped loader.
  ```

### [ARCHITECTURE] Domain and shared modules import from a UI component folder

- **Location:** `src/lib/server/domain/settings.ts:7`, `src/lib/server/services/settings-service.ts:1`,
  `src/lib/shared/settings.ts:7`, `src/lib/tree-layout/highlight.ts`, `src/routes/+layout.server.ts`
- **Observation:** The ADR-054 settings work put the palette model in
  `src/lib/components/tree/palette.ts` and then imported it from the domain layer, the service
  layer and `shared/`. `palette.ts` is pure (it imports only `tree-tokens.ts` and `shared/colour.ts`),
  so nothing breaks today, but the dependency points the wrong way: the server's contrast rules now
  depend on a component folder. Anyone tidying `components/tree/` can break server validation.
- **Refactoring strategy:** Move `palette.ts` and `tree-tokens.ts` to `src/lib/shared/` and
  re-export from the old path only if a temporary shim is needed. Add an ESLint
  `no-restricted-imports` rule so `src/lib/server/**` and `src/lib/shared/**` cannot import
  `#lib/components/**`.
- **Current code snippet:**
  ```typescript
  // src/lib/server/domain/settings.ts
  import { resolvePalette } from '#lib/components/tree/palette.js';
  ```
- **Refactored code snippet:**
  ```typescript
  // src/lib/server/domain/settings.ts
  import { resolvePalette } from '#lib/shared/palette.js';

  // eslint.config.js, for files: ['src/lib/server/**', 'src/lib/shared/**']
  'no-restricted-imports': ['error', { patterns: ['#lib/components/*', '$app/*'] }]
  ```

### [TYPE SAFETY] Response shapes are asserted on the client, not checked

- **Location:** `src/lib/server/http/handler.ts` (`type Result = Response | unknown`),
  `src/lib/services/tree-api.ts` (`call<T>`)
- **Observation:** The DTOs are shared (`PersonPageDto`, `FileListDto`, `MarksDto` and others), so
  most payloads agree. The drift is in the envelopes around them, which each endpoint invents:
  `{ tree }`, `{ individual, change }`, `{ success: true, … }` (10 endpoints), `{ trees }`. The
  handler's `Result = Response | unknown` collapses to `unknown`, and the client's `call<T>` ends
  with `return data as T`. A renamed envelope key compiles on both sides and fails at run time.
- **Refactoring strategy:** Let the handler infer and export what each endpoint returns, and have
  the client import that type instead of restating it. No code generation is needed. Drop
  `success: true`; the status code already says it.
- **Current code snippet:**
  ```typescript
  // handler.ts
  type Result = Response | unknown;

  // tree-api.ts
  const data = await call<{ tree: { id: string; name: string } }>(
  	'/api/trees',
  	json('POST', payload),
  	'Failed to create tree'
  );
  ```
- **Refactored code snippet:**
  ```typescript
  // src/lib/shared/api-contracts.ts: one envelope type per endpoint, both sides import it
  export interface CreateTreeResponse {
  	tree: { id: string; name: string };
  }

  // routes/api/trees/+server.ts: the handler must return the contract
  export const POST = apiHandler(
  	{ failure: 'Failed to create tree', body: createTreeSchema, status: 201 },
  	async ({ db, ctx, body }): Promise<CreateTreeResponse> => ({
  		tree: await new TreeService(db).createTree(body, ctx)
  	})
  );

  // tree-api.ts
  const { tree } = await call<CreateTreeResponse>('/api/trees', json('POST', payload), '…');
  ```

### [TYPE SAFETY] `RowOp` images are untyped, which forces `any` in the change log

- **Location:** `src/lib/server/domain/change-log.ts:140`, `src/lib/server/domain/impact.ts:26,64,87`,
  `src/lib/server/domain/tree-labels.ts:129`, `src/lib/server/repositories/change-store.ts`
- **Observation:** `RowImage` is `Record<string, unknown>` and `RowOp.table` is a plain union, so
  every consumer that switches on `op.table` must cast the row: `as Record<string, any>` in
  `impact.ts` and `tree-labels.ts`, and most of the 27 `as unknown as` casts in the repositories. The
  `switch` already narrows `table`; the type just does not carry the row with it.
- **Refactoring strategy:** Map each table to its row type and make `RowOp` a discriminated union.
  The switches then type-check without casts, and a new column reaches every reader.
- **Current code snippet:**
  ```typescript
  export type RowImage = Record<string, unknown>;

  export interface RowOp {
  	table: RecordTable;
  	id: string;
  	before: RowImage | null;
  	after: RowImage | null;
  }

  // impact.ts
  const row = (op.after ?? op.before) as Record<string, any>;
  ```
- **Refactored code snippet:**
  ```typescript
  interface TableRows {
  	individuals: IndividualRow;
  	person_names: PersonNameRow;
  	unions: UnionRow;
  	// … one entry per RecordTable
  }
  export type RecordTable = keyof TableRows;

  export type RowOp = {
  	[T in RecordTable]: { table: T; id: string; before: TableRows[T] | null; after: TableRows[T] | null };
  }[RecordTable];

  // impact.ts: no cast; `row` narrows with `op.table`
  switch (op.table) {
  	case 'person_names':
  		return [(op.after ?? op.before)!.personId];
  }
  ```

### [TYPE SAFETY] `no-explicit-any` is a warning, so about 30 uses pass the push gate

- **Location:** `eslint.config.js:68`; `catch (e: any)` in 17 places (`tree-editor.svelte.ts`,
  `tree-shell.svelte.ts`, `RelationshipModal.svelte`, `UnionMergeDialog.svelte` and others);
  `PersonModal.svelte:53`; `BaseModal.svelte:7` (`icon?: any`); `load-helpers.ts:17`
- **Observation:** The config comment says the warning was temporary while "about forty existing
  uses are tracked for a typing pass". About 30 remain. Most are `catch (e: any)` followed by
  `e.message`, which the next finding removes. `LoadEventLike = any` is the one that defeats
  SvelteKit's generated load types.
- **Refactoring strategy:** Fix the remaining uses, then set the rule to `'error'`. For
  `treeLoad`, constrain the event structurally so no `eslint-disable` is needed. For `BaseModal`,
  use Lucide's `Component` type.
- **Current code snippet:**
  ```typescript
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type LoadEventLike = any;

  export function treeLoad<Load extends (event: LoadEventLike) => unknown>(run: Load): Load {
  ```
- **Refactored code snippet:**
  ```typescript
  /** The one thing `treeLoad` needs of a SvelteKit load event. */
  interface DependsOn {
  	depends(...deps: `${string}:${string}`[]): void;
  }

  export function treeLoad<E extends DependsOn, R>(run: (event: E) => Promise<R>) {
  	return async (event: E): Promise<R> => {
  		event.depends(DATA_KEY);
  		try {
  			return await run(event);
  		} catch (cause) {
  			rethrowAsPageError(cause);
  		}
  	};
  }
  ```

### [DRY] A dozen dialogs repeat the same save, conflict and error handling

- **Location:** `NameDialog.svelte`, `FactDialog.svelte`, `TaskDialog.svelte`, `SourceDialog.svelte`,
  `RepositoryDialog.svelte`, `CitationDialog.svelte`, `NoteDialog.svelte`, `SharedNoteDialog.svelte`,
  `RepositoryLinkDialog.svelte`, `PlaceRewriteDialog.svelte`, `PersonMergeDialog.svelte`,
  `UnionEditorModal.svelte` and others; the idiom `(cause as Error).message || '…'` appears 51 times
- **Observation:** Each dialog has the same 12 lines: set `isSaving`, clear the error, try the call,
  on a conflict call `onstale`, otherwise show the message, and clear `isSaving` in `finally`. The
  shape is genuinely identical; only the call and the fallback text differ. The variable is `error`
  in some dialogs and `saveError` in others, and `SourceDialog` passes an extra id to `onsaved`, so
  the helper must not own `onsaved`. `TreeEditor.mutate` (`tree-editor.svelte.ts:205`) already
  proves the pattern in-house.
- **Refactoring strategy:** Add `src/lib/components/forms/submission.svelte.ts` holding `isSaving`
  and `error` as runes and taking a `run()` callback that calls `onsaved` itself. Add a one-line
  `messageOf(cause, fallback)` to `tree-api.ts` and use it everywhere the idiom appears, including
  the `catch (e: any)` sites.
- **Current code snippet:**
  ```typescript
  // TaskDialog.svelte (SourceDialog, FactDialog, NameDialog… are the same)
  isSaving = true;
  error = null;
  try {
  	const { change } = task
  		? await updateTaskApi(treeId, task.id, { ...input, status }, task.version)
  		: await createTaskApi(treeId, input, { subject: about?.ref ?? null, findingKey });
  	await onsaved(change);
  } catch (cause: unknown) {
  	if (isConflict(cause)) await onstale(cause.message);
  	else error = (cause as Error).message || 'Could not save the task';
  } finally {
  	isSaving = false;
  }
  ```
- **Refactored code snippet:**
  ```typescript
  // tree-api.ts
  export function messageOf(cause: unknown, fallback: string): string {
  	return cause instanceof Error && cause.message ? cause.message : fallback;
  }

  // forms/submission.svelte.ts
  export function createSubmission(onstale: (message: string) => Promise<void> | void) {
  	let isSaving = $state(false);
  	let error = $state<string | null>(null);
  	return {
  		get isSaving() { return isSaving; },
  		get error() { return error; },
  		async submit(run: () => Promise<void>, fallback: string): Promise<void> {
  			isSaving = true;
  			error = null;
  			try {
  				await run();
  			} catch (cause) {
  				if (isConflict(cause)) await onstale(cause.message);
  				else error = messageOf(cause, fallback);
  			} finally {
  				isSaving = false;
  			}
  		}
  	};
  }

  // TaskDialog.svelte
  const save = createSubmission(onstale);
  const submit = () =>
  	save.submit(async () => {
  		const { change } = task
  			? await updateTaskApi(treeId, task.id, { ...input, status }, task.version)
  			: await createTaskApi(treeId, input, { subject: about?.ref ?? null, findingKey });
  		await onsaved(change);
  	}, 'Could not save the task');
  ```

### [COMPONENT SIZE] The tree page mixes view state, navigation and the drawer

- **Location:** `src/routes/trees/[id]/+page.svelte` (784 lines: 556 script, 7 `$effect`s)
- **Observation:** The script holds three separable concerns: URL-backed view state with a
  one-at-a-time navigation queue (`navigate`, `commitNavigation`, `pendingSearch`,
  `queuedNavigation`); the details drawer's fetch with a request counter to drop stale responses;
  and choosing and running a layout per mode. The effects themselves are sound:
  `editor.graph = graph` syncs a context object and cleans up on teardown, and the drawer effect
  guards against out-of-order responses. They are hard to test only because they live in a route.
- **Refactoring strategy:** Extract `tree-navigation.svelte.ts` (the queue, `pendingSearch`,
  `navigate`, `withOpenDrawer`) and `drawer-loader.svelte.ts` (the fetch, its guard and its error)
  beside `tree-editor.svelte.ts`. The page keeps the wiring and the markup. The queue then gets unit
  tests for "a second click during a navigation".
- **Current code snippet:**
  ```typescript
  let isNavigating = false;
  let queuedNavigation: { query: string; kind?: HistoryKind; isReplace?: boolean } | null = null;

  function commitNavigation(query: string, kind?: HistoryKind, isReplace?: boolean) {
  	isNavigating = true;
  	void goto(query ? `?${query}` : page.url.pathname, {
  		replace: isReplace ?? (kind ? historyCoalescer.shouldReplace(kind) : false),
  		reset: false
  	}).finally(() => {
  		isNavigating = false;
  		const next = queuedNavigation;
  		queuedNavigation = null;
  		if (next) commitNavigation(next.query, next.kind, next.isReplace);
  		else pendingSearch = null;
  	});
  }
  ```
- **Refactored code snippet:**
  ```typescript
  // components/tree/tree-navigation.svelte.ts
  export function createTreeNavigation(go: (href: string, isReplace: boolean) => Promise<void>) {
  	const coalescer = createHistoryCoalescer();
  	let pendingSearch = $state<string | null>(null);
  	let isNavigating = false;
  	let queued: Navigation | null = null;

  	function commit({ query, kind, isReplace }: Navigation) {
  		isNavigating = true;
  		void go(query, isReplace ?? (kind ? coalescer.shouldReplace(kind) : false)).finally(() => {
  			isNavigating = false;
  			const next = queued;
  			queued = null;
  			if (next) commit(next);
  			else pendingSearch = null;
  		});
  	}

  	return {
  		get pendingSearch() { return pendingSearch; },
  		push(next: Navigation) {
  			pendingSearch = next.query ? `?${next.query}` : '';
  			if (isNavigating) queued = next;
  			else commit(next);
  		}
  	};
  }
  ```

### [COMPONENT SIZE] `WebGlTreeShell.svelte` holds a highlight state machine inside a view

- **Location:** `src/lib/components/tree/WebGlTreeShell.svelte` (966 lines: 511 script, 273 markup,
  182 style)
- **Observation:** Lines 144 to 200 are a self-contained state machine: a selection tied to the
  layout it was made on, a cleared flag, trace mode with a capped item list and a notice. It
  depends only on `kin`, `focusPersonId` and `palette`. Lines 202 to 272 position the hover card
  from pointer and size state. Both are mixed with pointer handlers, label placement and camera
  presets.
- **Refactoring strategy:** Move the highlight block to `webgl-highlight.svelte.ts` (taking getters
  for `kin`, `focusPersonId` and `palette`) and the hover card, with its positioning, to
  `WebGlHoverCard.svelte`. The shell keeps the canvas, pointer, keyboard and announcements. The
  state machine can then be unit-tested without WebGL.
- **Current code snippet:**
  ```typescript
  let selection = $state.raw<{ kin: KinSource; source: HighlightSource } | null>(null);
  let clearedKin = $state.raw<KinSource | null>(null);
  const isHighlightCleared = $derived(clearedKin === kin);
  let isTracing = $state(false);
  let traceItems = $state.raw<HighlightSource[]>([]);
  let notice = $state<string | null>(null);
  const liveTrace = $derived(traceItems.filter((item) => isSourcePresent(kin, item)));
  const activeSelection = $derived(selection?.kin === kin ? selection.source : null);
  const highlight = $derived.by<Highlight>(() => {
  	if (isHighlightCleared) return QUIET_HIGHLIGHT;
  	if (isTracing) return computeHighlight(kin, liveTrace, true, palette);
  	// …
  });
  ```
- **Refactored code snippet:**
  ```typescript
  // webgl-highlight.svelte.ts
  export function createHighlightState(input: {
  	kin: () => KinSource;
  	focusPersonId: () => string | null;
  	palette: () => Palette;
  }) {
  	let selection = $state.raw<{ kin: KinSource; source: HighlightSource } | null>(null);
  	let clearedKin = $state.raw<KinSource | null>(null);
  	let isTracing = $state(false);
  	let traceItems = $state.raw<HighlightSource[]>([]);
  	let notice = $state<string | null>(null);
  	const liveTrace = $derived(traceItems.filter((item) => isSourcePresent(input.kin(), item)));
  	const highlight = $derived.by<Highlight>(() => { /* unchanged */ });
  	return {
  		get highlight() { return highlight; },
  		get notice() { return notice; },
  		get isTracing() { return isTracing; },
  		toggleTrace, setTracing, select, clear
  	};
  }

  // WebGlTreeShell.svelte
  const lit = createHighlightState({ kin: () => kin, focusPersonId: () => focusPersonId, palette: () => palette });
  ```

### [ARCHITECTURE] `tree-ops.ts` inlines the person and union commands that its siblings split out

- **Location:** `src/lib/server/domain/tree-ops.ts` (1,119 lines)
- **Observation:** Evidence, notes, media, tasks, places, dates and merges each have their own
  `*-ops.ts` module that `buildOps` dispatches to. Person commands (`createPerson` to
  `deletePerson`, lines 390 to 552) and union and parent-child commands (`createUnion` to
  `mergeUnions`, lines 553 to 1012) are still inline, beside the shared helpers and the dispatcher.
  The file reads as three modules.
- **Refactoring strategy:** Move them to `person-ops.ts` and `union-ops.ts`, mirroring the existing
  modules. Keep `requirePerson`, `touch`, `bump`, version checks and `mergeOps` in `tree-ops.ts`
  (or a small `op-helpers.ts`) with the dispatcher and `buildPlanOps`. This is a move, not a
  rewrite; the pure functions and their tests stay as they are.
- **Current code snippet:**
  ```typescript
  case 'create_person':
  	return createPerson(rows, ctx, command);   // defined at line 390 of this file
  // …
  case 'merge_unions':
  	return mergeUnions(rows, ctx, command);    // defined at line 871 of this file
  ```
- **Refactored code snippet:**
  ```typescript
  case 'create_person':
  case 'update_person':
  case 'delete_person':
  case 'set_person_privacy':
  case 'record_death':
  	return buildPersonOps(rows, command, ctx);
  case 'create_union':
  // … through 'merge_unions'
  	return buildUnionOps(rows, command, ctx);
  ```

### [DRY / ARCHITECTURE] The client API module is one 1,800-line file with mixed path encoding

- **Location:** `src/lib/services/tree-api.ts` (1,803 lines, 129 exports)
- **Observation:** Every client call for trees, people, names, facts, evidence, notes, tasks,
  files, members, settings and export sits in one file, so unrelated changes collide in review.
  Path segments are passed through `enc()` 82 times and interpolated raw about 20 times
  (`/api/trees/${treeId}/people/${personId}`). The ids are server-generated and slugs are
  constrained, so this is consistency, not a security hole. Separately, `src/lib/services/`
  (browser fetch wrappers) and `src/lib/server/services/` (domain services) share a name.
- **Refactoring strategy:** Rename `src/lib/services/` to `src/lib/api/`, keep `call`, `ApiError`
  and `messageOf` in `api/client.ts`, and split the functions by resource (`api/people.ts`,
  `api/evidence.ts`, …). Build paths with one tagged helper so encoding cannot be forgotten.
- **Current code snippet:**
  ```typescript
  await call(`/api/trees/${treeId}`, { method: 'DELETE' }, 'Failed to delete tree');
  // …
  `/api/trees/${enc(treeId)}`,
  ```
- **Refactored code snippet:**
  ```typescript
  // api/client.ts
  export const path = (strings: TemplateStringsArray, ...parts: Array<string | number>) =>
  	strings.reduce((out, s, i) => out + s + (i < parts.length ? encodeURIComponent(parts[i]) : ''), '');

  // api/trees.ts
  await call(path`/api/trees/${treeId}`, { method: 'DELETE' }, 'Failed to delete tree');
  ```

### [COMPONENT SIZE] Primary buttons are copied as Tailwind strings in 23 places

- **Location:** 29 Svelte files contain `bg-emerald-800`; `px-4 py-2` 14 times, `px-3 py-1.5`
  8 times, `px-2.5 py-1.5` once
- **Observation:** `src/app.css` already defines `.action-btn`, `.field-input` and `.field-label`
  for the secondary styles, but not the primary button. Each copy carries its own hover, focus and
  disabled classes, so a change to the primary colour or focus ring touches 23 places.
- **Refactoring strategy:** Add `.btn-primary` (and a `.btn-primary-sm` for the toolbar size) in
  the same `@layer components` block. A `Button.svelte` component is not needed; the CSS class
  matches the existing convention and keeps markup simple.
- **Current code snippet:**
  ```svelte
  <button
  	class="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-emerald-800 px-3 py-1.5 text-xs font-semibold text-amber-50 shadow-sm hover:bg-emerald-700"
  >
  ```
- **Refactored code snippet:**
  ```css
  /* app.css, @layer components */
  .btn-primary {
  	@apply inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-emerald-800
  		px-4 py-2 text-sm font-semibold text-amber-50 shadow-sm hover:bg-emerald-700 disabled:opacity-60;
  }
  .btn-primary-sm {
  	@apply inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-emerald-800
  		px-3 py-1.5 text-xs font-semibold text-amber-50 shadow-sm hover:bg-emerald-700 disabled:opacity-60;
  }
  ```

### [DOCUMENTATION] `AGENTS.md` copies the architecture instead of linking to it

- **Location:** `AGENTS.md` ("Architecture"), `docs/architecture.md` ("Layering", "Data model")
- **Observation:** The layering list, data model and resource list appear in both files, nearly
  word for word. `AGENTS.md` itself says to update the docs "not this file", so the copy will drift:
  it already lacks the `shared/` import rule and the mutation runner that `architecture.md` states.
  Smaller points: ADR-029 sits after ADR-030 in `decisions.md`, and some TSDoc runs to 130-character
  single lines that Prettier cannot wrap.
- **Refactoring strategy:** Keep in `AGENTS.md` only what an agent must not get wrong (the three
  "Important notes", conventions, commit rules) and replace the architecture section with a
  three-line summary and a link.
- **Current code snippet:**
  ```markdown
  **Layering** (enforced — routes never touch the database directly):

  1. **Domain** (`src/lib/server/domain/`) — pure models, command interfaces, typed errors
  …
  ```
- **Refactored code snippet:**
  ```markdown
  ## Architecture

  Layered domain → repositories → services → routes; routes never touch D1, and `server/` and
  `shared/` never import `components/`. Every edit goes through the mutation runner. Read
  `docs/architecture.md` before changing a layer boundary or the data model.
  ```

## Already tracked, not raised again

- **Universal loads call the API through `event.fetch`** (backlog, "Code structure"). Left as
  deferred; the loaders that exist are well-parallelised. The one remaining sequential step is the
  tree page's `await parent()` before its graph fetch, which it needs for the saved view mode.
- **`RelationshipModal.svelte`** (backlog, "Code structure") was reviewed and left whole at about 860
  lines. It is 873 now. Revisit when the next intent is added, as recorded.

## Low priority

- Server modules use relative imports without `.js` (about 1,480), while client modules use
  `#lib/…js`. It is consistent within each side; a mass rewrite is churn for no behaviour.
- Twelve exported functions lack an explicit return type (for example `getDb`, `makeNoteMover`,
  `factDetailColumns`). Add them when the files are next touched.

## Executive summary

**Code health grade: A−.** The server is unusually disciplined for a week of fast growth: one
handler factory, a pure planner with exact previews, deny-by-default, typed domain errors, lazy
WebGL, and comments that explain decisions. The grade is held back by untyped seams (the change-log
row images and the API envelopes), a layering inversion introduced with settings, duplicated client
error handling, and a few route and view components that have absorbed state logic.

**Top refactoring priorities**

1. Track and measure the whole-tree read on every write; it is the main scaling risk.
2. Move `palette.ts` and `tree-tokens.ts` to `shared/`, and lint against `server/` or `shared/`
   importing `components/`.
3. Type `RowOp` as a discriminated union and the API envelopes as shared contracts; this removes
   most `any` and `as unknown as` casts.
4. Add `messageOf` and `createSubmission`, clear the remaining `any`, and make `no-explicit-any` an
   error.
5. Split `tree-api.ts` by resource under `src/lib/api/`.

**Component breakdown roadmap**

1. `routes/trees/[id]/+page.svelte`: extract navigation and the drawer loader.
2. `components/tree/WebGlTreeShell.svelte`: extract the highlight state and the hover card.
3. The save dialogs: adopt `createSubmission`.
4. `server/domain/tree-ops.ts`: move person and union commands to their own modules.
5. `routes/trees/[id]/files/+page.svelte` (536 lines of markup): extract the file row and its
   action buttons once `.btn-primary` exists.
6. Documentation: trim the architecture copy in `AGENTS.md`; reorder ADR-029.
