<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { navigating, page } from '$app/state';
	import { Loader2 } from 'lucide-svelte';
	import PersonDrawer from '#lib/components/tree/PersonDrawer.svelte';
	import FloorsCanvas from '#lib/components/tree/FloorsCanvas.svelte';
	import LayersCanvas from '#lib/components/tree/LayersCanvas.svelte';
	import TreeCanvas from '#lib/components/tree/TreeCanvas.svelte';
	import TreeToolbar from '#lib/components/tree/TreeToolbar.svelte';
	import type { TreeEditActions } from '#lib/components/tree/tree-actions.js';
	import { getTreeContext } from '#lib/components/tree/tree-context.js';
	import {
		ALL_PARENT_CHILD_TYPES,
		DEFAULT_VIEW_STATE,
		HISTORY_KINDS,
		LAYERS_DEFAULT_COLLATERAL_DEPTH,
		LAYOUT_MODES,
		compactStubId,
		createHistoryCoalescer,
		parseViewState,
		resolveStubTokens,
		serializeViewState,
		type HistoryKind,
		type TreeViewState
	} from '#lib/components/tree/tree-url.js';
	import type { PersonPageDto } from '#lib/shared/person-page.js';
	import {
		fetchPersonPage,
		recordRecentApi,
		saveDefaultViewMode,
		saveViewMode
	} from '#lib/services/tree-api.js';
	import { EMPTY_LAYOUT, filterParentChildTypes, layoutFocusView } from '#lib/tree-layout/index.js';
	import { layoutFloors } from '#lib/tree-layout/floors.js';
	import { layoutLayers } from '#lib/tree-layout/layers.js';
	import { rememberedFocusKey } from '#lib/services/load-helpers.js';
	import { resolveLayoutMode, type LayoutMode } from '#lib/shared/view-mode.js';
	import type { PageData } from './$types';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();
	const { editor, marks, toasts, finder } = getTreeContext();
	const role = $derived(data.trees.find((t) => t.id === treeId)?.role);
	const historyCoalescer = createHistoryCoalescer();

	const treeId = $derived(page.params.id!);
	/** The address a navigation is heading for, shown before the load commits it; see `navigate`. */
	let pendingSearch = $state<string | null>(null);
	/**
	 * The view (focus, depths, toggles, opened stubs) lives in the URL so reloads, back/forward and
	 * shared links restore it. Everything below derives from it rather than keeping a second copy.
	 */
	/**
	 * The view saved for this tree: what the viewer chose, else what the owner set. A change made
	 * here shows at once; a reload reads the same from the tree list. Reset when the tree changes.
	 */
	let savedViews = $state<{ treeId: string; member?: LayoutMode | null; tree?: LayoutMode | null }>(
		{ treeId: '' }
	);
	const savedFor = $derived(savedViews.treeId === treeId ? savedViews : { treeId });
	const memberTree = $derived(data.trees.find((t) => t.id === treeId));
	const savedMemberMode = $derived(
		'member' in savedFor ? (savedFor.member ?? null) : (memberTree?.viewMode ?? null)
	);
	const savedTreeMode = $derived(
		'tree' in savedFor ? (savedFor.tree ?? null) : (memberTree?.defaultViewMode ?? null)
	);
	/** A link with no `mode` opens here; the address wins when it names one. */
	const startingMode = $derived(
		resolveLayoutMode({ fromAddress: null, fromMember: savedMemberMode, fromTree: savedTreeMode })
	);
	const view = $derived(
		parseViewState(new URLSearchParams(pendingSearch ?? page.url.search), startingMode)
	);
	/** What the graph on screen was fetched for. The canvas draws with this, and the toolbar shows `view`. */
	const applied = $derived(data.applied);
	const graph = $derived(data.focusGraph?.graph ?? null);
	/** The graph reaches the tree as a window; the editor's dialogs read versions and names from it. */
	$effect(() => {
		editor.graph = graph;
		return () => (editor.graph = null);
	});

	const focusPersonId = $derived(data.focusGraph?.focusPersonId ?? null);
	const focusPerson = $derived.by(() => {
		const person = graph?.people.find((p) => p.id === focusPersonId);
		return person ? { id: person.id, name: person.displayName } : null;
	});
	const expandedStubIds = $derived(
		graph
			? resolveStubTokens(
					applied.expandedStubs,
					graph.people.map((p) => p.id),
					graph.unions.map((u) => u.id)
				)
			: []
	);
	const graphForLayout = $derived(
		graph && view.types.length < ALL_PARENT_CHILD_TYPES.length
			? filterParentChildTypes(graph, view.types)
			: graph
	);
	const mode = $derived(view.layoutMode);
	/**
	 * A tilted stack needs width to read. Under this many pixels Layers shows one plane at a time
	 * and Floors draws the flat view, with a note, rather than a tilt too small to use.
	 */
	const PHONE_MAX_WIDTH_PX = 639;
	let isPhone = $state(false);
	$effect(() => {
		const query = matchMedia(`(max-width: ${PHONE_MAX_WIDTH_PX}px)`);
		isPhone = query.matches;
		const onChange = (event: MediaQueryListEvent) => (isPhone = event.matches);
		query.addEventListener('change', onChange);
		return () => query.removeEventListener('change', onChange);
	});
	/** What is drawn: the address says Floors, a phone gets the hourglass. */
	const drawnMode = $derived(isPhone && mode === LAYOUT_MODES.FLOORS ? LAYOUT_MODES.FLAT : mode);
	const isFloorsOnPhone = $derived(drawnMode !== mode);
	/**
	 * A new focus, depth or option waits on the server for its graph, and the 3D views then lay it
	 * out, so the chart on screen is stale for a moment. The address is ahead of the load while this
	 * is true; the badge says so instead of leaving a click looking ignored.
	 */
	const isLoading = $derived(pendingSearch !== null || navigating.to !== null);
	const focusOptions = $derived({
		ancestorDepth: applied.ancestorDepth,
		descendantDepth: applied.descendantDepth,
		shouldIncludeSiblings: applied.shouldIncludeSiblings,
		shouldIncludeStepFamilies: applied.shouldIncludeStepFamilies,
		// Flat draws the hourglass it always has; the wider groups are for the 3D views.
		...(drawnMode === LAYOUT_MODES.FLAT
			? {}
			: {
					collateralDepth: applied.collateralDepth,
					shouldIncludePartnerOrigins: applied.shouldIncludePartnerOrigins
				}),
		expandedStubIds
	});
	// Only the chosen view is laid out, so switching mode costs one layout and no request.
	const layout = $derived(
		graphForLayout && drawnMode === LAYOUT_MODES.FLAT
			? layoutFocusView(graphForLayout, focusPersonId, focusOptions)
			: EMPTY_LAYOUT
	);
	const floorsLayout = $derived(
		graphForLayout && drawnMode === LAYOUT_MODES.FLOORS
			? layoutFloors(graphForLayout, focusPersonId, focusOptions)
			: null
	);
	const layersLayout = $derived(
		graphForLayout && drawnMode === LAYOUT_MODES.LAYERS
			? layoutLayers(graphForLayout, focusPersonId, view.unionId, focusOptions)
			: null
	);

	/**
	 * Layers draws cousins and a partner's family, so it asks for them unless the address already
	 * says. Done once on arrival: a viewer who then turns them off is not asked again.
	 */
	let hasDefaultedLayers = false;
	$effect(() => {
		if (mode !== LAYOUT_MODES.LAYERS) {
			hasDefaultedLayers = false;
			return;
		}
		if (hasDefaultedLayers) return;
		hasDefaultedLayers = true;
		untrack(() => {
			if (view.collateralDepth > 0 || view.shouldIncludePartnerOrigins) return;
			navigate(
				{
					collateralDepth: LAYERS_DEFAULT_COLLATERAL_DEPTH,
					shouldIncludePartnerOrigins: true,
					expandedStubs: view.expandedStubs
				},
				{ isReplace: true }
			);
		});
	});

	/** Re-frame the canvas when this changes. Opening a stub is deliberately not part of it. */
	const viewSignature = $derived(
		JSON.stringify([
			treeId,
			focusPersonId,
			applied.ancestorDepth,
			applied.descendantDepth,
			applied.shouldIncludeSiblings,
			applied.shouldIncludeStepFamilies,
			applied.collateralDepth,
			applied.shouldIncludePartnerOrigins,
			view.types,
			drawnMode,
			// Another union recentres the planes, so it re-frames like a new focus.
			layersLayout?.focusUnionId ?? null
		])
	);
	/** Bumped when the data reloads without the person having opened a stub, so an edit re-frames the canvas. */
	let dataVersion = $state(0);
	let lastOpenedStubs = '';
	$effect(() => {
		void data.focusGraph;
		const opened = applied.expandedStubs.join(',');
		untrack(() => {
			if (opened === lastOpenedStubs) dataVersion++;
			lastOpenedStubs = opened;
		});
	});
	const fitKey = $derived(`${viewSignature}|${dataVersion}`);

	// Write the resolved focus back into the address so it always describes the view, without a new
	// history entry and without asking the server again.
	$effect(() => {
		const resolved = focusPersonId;
		if (!resolved || page.url.searchParams.get('focus') === resolved) return;
		untrack(() => {
			const query = serializeViewState({
				...parseViewState(page.url.searchParams, startingMode),
				treeId: null,
				focusId: resolved
			}).toString();
			void goto(query ? `?${query}` : page.url.pathname, {
				shallow: true,
				replace: true,
				state: page.state,
				reset: false
			});
		});
	});

	/**
	 * Change the URL. `kind` decides the history entry: a new focus always gets one, so Back returns
	 * to the previous person, while depth and toggle changes and opened stubs share one entry for as
	 * long as the clicks keep coming, so Back undoes a burst of stepper clicks in one go.
	 */
	function navigate(
		change: Partial<TreeViewState>,
		options: { kind?: HistoryKind; isReplace?: boolean } = {}
	) {
		// Anything but an explicit stub change starts the new view with its stubs closed.
		const stubs = 'expandedStubs' in change ? {} : { expandedStubs: [] };
		const currentFocus = view.focusId ?? focusPersonId;
		// A union belongs to the person it was picked for, so another focus starts from their first.
		const isRefocus = 'focusId' in change && change.focusId !== currentFocus;
		const union = isRefocus && !('unionId' in change) ? { unionId: null } : {};
		const query = serializeViewState({
			...view,
			treeId: null,
			focusId: currentFocus,
			...stubs,
			...union,
			...change
		}).toString();
		// The address only changes once the new graph has loaded, so a second click straight after the
		// first would read the old view. Show the new view at once and let the load catch up. Only one
		// navigation runs at a time: a second would cancel the first, and "replace the last entry"
		// would then overwrite the entry the first should have pushed.
		pendingSearch = query ? `?${query}` : '';
		if (isNavigating)
			queuedNavigation = { query, kind: options.kind, isReplace: options.isReplace };
		else commitNavigation(query, options.kind, options.isReplace);
	}

	let isNavigating = false;
	let queuedNavigation: { query: string; kind?: HistoryKind; isReplace?: boolean } | null = null;

	function commitNavigation(query: string, kind?: HistoryKind, isReplace?: boolean) {
		isNavigating = true;
		void goto(query ? `?${query}` : page.url.pathname, {
			replace: isReplace ?? (kind ? historyCoalescer.shouldReplace(kind) : false),
			// Leave scroll and the focused element alone; the tree view changes in place.
			reset: false
		}).finally(() => {
			isNavigating = false;
			const next = queuedNavigation;
			queuedNavigation = null;
			if (next) commitNavigation(next.query, next.kind, next.isReplace);
			else pendingSearch = null;
		});
	}

	/** Picking someone in the header finder is opening them: it refocuses and counts as a recent. */
	function pickFocus(id: string) {
		navigate(withOpenDrawer(id), { kind: HISTORY_KINDS.FOCUS });
		void recordRecentApi(treeId, id)
			.then((updated) => marks.set(updated))
			.catch(() => {
				// Recents are a convenience; a failed record is not worth a message.
			});
	}

	// The header's finder refocuses the chart through this while the chart is on screen.
	$effect(() => {
		finder.pickFocus = pickFocus;
		return () => (finder.pickFocus = null);
	});

	function rememberFocus(id: string) {
		try {
			localStorage.setItem(rememberedFocusKey(treeId), id);
		} catch {
			// Remembering the focus is a convenience only.
		}
	}

	function setFocus(id: string) {
		rememberFocus(id);
		navigate(withOpenDrawer(id), { kind: HISTORY_KINDS.FOCUS });
	}

	/** A new focus takes an open drawer along, so the drawer keeps describing the person at the centre. */
	const withOpenDrawer = (id: string): Partial<TreeViewState> => ({
		focusId: id,
		...(view.personId ? { personId: id } : {})
	});

	// ---- The details drawer ----
	/** The drawer lives in the address, so a reload, Back and a shared link all find it as it was. */
	const selectedPersonId = $derived(view.personId);
	let drawerPage = $state<PersonPageDto | null>(null);
	let drawerError = $state<string | null>(null);
	let drawerRequest = 0;
	/** The card the drawer was opened from, so closing it can hand focus back. */
	let openerCardId: string | null = null;

	$effect(() => {
		const id = selectedPersonId;
		// Reload with the tree: an edit, an undo or a new focus all change what the drawer should say.
		void data.focusGraph;
		if (!id) {
			drawerPage = null;
			drawerError = null;
			return;
		}
		const request = ++drawerRequest;
		fetchPersonPage(treeId, id)
			.then((loaded) => {
				if (request !== drawerRequest) return;
				drawerPage = loaded;
				drawerError = null;
			})
			.catch((cause: Error) => {
				if (request !== drawerRequest) return;
				// The person is gone (deleted, undone away, or a stale link): there is nothing to keep
				// open. Replacing the entry keeps Back from returning to a drawer that cannot open.
				navigate({ personId: null, expandedStubs: view.expandedStubs }, { isReplace: true });
				drawerError = cause.message;
			});
	});

	/** Close the drawer; the tree stays as it is, and focus returns to the card that opened it if it is still drawn. */
	function clearSelection() {
		if (!selectedPersonId) return;
		navigate({ personId: null, expandedStubs: view.expandedStubs }, { kind: HISTORY_KINDS.ADJUST });
		const card = openerCardId;
		openerCardId = null;
		if (!card) return;
		void tick().then(() =>
			document.querySelector<SVGGElement>(`[data-person-id="${CSS.escape(card)}"]`)?.focus()
		);
	}

	function expandStub(id: string) {
		const token = compactStubId(id);
		if (token)
			navigate(
				{ expandedStubs: [...new Set([...view.expandedStubs, token])] },
				{ kind: HISTORY_KINDS.ADJUST }
			);
	}

	function collapseStub(id: string) {
		const token = compactStubId(id);
		navigate(
			{ expandedStubs: view.expandedStubs.filter((t) => t !== token) },
			{ kind: HISTORY_KINDS.ADJUST }
		);
	}

	/** What the 3D canvases' context menus can do; the flat canvas takes the same actions one by one. */
	const actions = $derived<TreeEditActions>({
		onOpenPerson: handleOpenPerson,
		onEditPerson: (id) => void editor.openEditPerson(id),
		onDeletePerson: editor.requestDeletePerson,
		onAddRelationship: (anchor) =>
			editor.openRelationship({ id: anchor.id, givenName: anchor.displayName, surname: null }),
		onRecordDeath: (id) => editor.openRelationship(editor.anchorFor(id), { kind: 'record_death' }),
		onEndPartnership: (id) => editor.openRelationship(editor.anchorFor(id), { kind: 'end_union' }),
		onEditUnion: editor.editUnion,
		onEndUnion: editor.endUnion,
		onRemoveUnion: editor.removeUnion,
		onMergeUnion: editor.mergeUnion,
		mergeableUnionIds: editor.mergeableIds
	});

	/** Save a default view, showing it at once and saying so when the save fails. */
	async function setDefaultView(scope: 'member' | 'tree', mode: LayoutMode | null) {
		const before = savedFor;
		savedViews = { ...savedFor, [scope]: mode };
		try {
			if (scope === 'member') await saveViewMode(treeId, mode);
			else await saveDefaultViewMode(treeId, mode);
		} catch (cause) {
			savedViews = before;
			toasts.push(cause instanceof Error ? cause.message : 'Could not save the default view', {
				tone: 'error',
				durationMs: 10_000
			});
		}
	}

	/** Canvas single-click: refocus the chart only. An already-open drawer follows the focus. */
	const handleFocusPerson = (id: string) => setFocus(id);

	/** Canvas double-click or long-press: focus the person and show their details. */
	function handleOpenPerson(id: string) {
		if (!selectedPersonId) openerCardId = id;
		rememberFocus(id);
		navigate({ focusId: id, personId: id }, { kind: HISTORY_KINDS.FOCUS });
	}

	/** From the drawer: clicking the selected person again closes it; the tree stays focused on them. */
	function handleSelectPerson(id: string) {
		if (selectedPersonId === id) {
			clearSelection();
			return;
		}
		rememberFocus(id);
		navigate({ focusId: id, personId: id }, { kind: HISTORY_KINDS.FOCUS });
	}
</script>

<div class="flex min-h-[600px] flex-1 flex-col">
	{#if graph}
		<div class="mb-3">
			<TreeToolbar
				{view}
				unionChoices={layersLayout?.unionChoices ?? []}
				focusUnionId={layersLayout?.focusUnionId ?? null}
				defaults={{
					member: savedMemberMode,
					tree: savedTreeMode,
					canSetTree: role === 'owner'
				}}
				onSetMemberDefault={(mode) => void setDefaultView('member', mode)}
				onSetTreeDefault={(mode) => void setDefaultView('tree', mode)}
				{focusPerson}
				onchangeFocus={() => finder.focusInput?.()}
				onopenProfile={(id) =>
					void goto(`/trees/${encodeURIComponent(treeId)}/people/${encodeURIComponent(id)}`)}
				onChange={(change) =>
					navigate(
						// Switching view redraws the same graph, so what the person opened stays open. Flat
						// ignores the wider groups, so going back to it also stops fetching them.
						'layoutMode' in change
							? {
									...change,
									expandedStubs: view.expandedStubs,
									...(change.layoutMode === LAYOUT_MODES.FLAT
										? {
												collateralDepth: DEFAULT_VIEW_STATE.collateralDepth,
												shouldIncludePartnerOrigins: DEFAULT_VIEW_STATE.shouldIncludePartnerOrigins
											}
										: {}),
									// Layers shows the cousin line, so arriving at it asks for the wider groups.
									...(change.layoutMode === LAYOUT_MODES.LAYERS &&
									view.collateralDepth === 0 &&
									!view.shouldIncludePartnerOrigins
										? {
												collateralDepth: LAYERS_DEFAULT_COLLATERAL_DEPTH,
												shouldIncludePartnerOrigins: true
											}
										: {})
								}
							: change,
						{ kind: HISTORY_KINDS.ADJUST }
					)}
			/>
		</div>
		{#if isFloorsOnPhone}
			<p class="mb-2 text-sm text-stone-600" role="note">
				Floors needs a wider screen, so this shows the flat view.
			</p>
		{/if}
		<!-- touch-none covers the overlays too: a pinch that starts on the zoom buttons or legend would
		     otherwise reach the browser and zoom the whole page instead of the chart. -->
		<div class="relative flex flex-1 touch-none flex-col" aria-busy={isLoading}>
			{#if layersLayout}
				<LayersCanvas
					layout={layersLayout}
					{fitKey}
					{selectedPersonId}
					onSelectPerson={handleFocusPerson}
					onOpenPerson={handleOpenPerson}
					onClearSelection={clearSelection}
					onExpandStub={expandStub}
					onCollapseStub={collapseStub}
					{actions}
					partnershipLabels={editor.unionLabels}
					onDragRelate={editor.dragRelate}
					isSinglePlane={isPhone}
				/>
			{:else if floorsLayout}
				<FloorsCanvas
					layout={floorsLayout}
					{fitKey}
					{selectedPersonId}
					onSelectPerson={handleFocusPerson}
					onOpenPerson={handleOpenPerson}
					onClearSelection={clearSelection}
					onExpandStub={expandStub}
					onCollapseStub={collapseStub}
					{actions}
					partnershipLabels={editor.unionLabels}
					onDragRelate={editor.dragRelate}
				/>
			{:else}
				<TreeCanvas
					{layout}
					{fitKey}
					{selectedPersonId}
					onSelectPerson={handleFocusPerson}
					onOpenPerson={handleOpenPerson}
					onClearSelection={clearSelection}
					onEditPerson={(id) => void editor.openEditPerson(id)}
					onDeletePerson={editor.requestDeletePerson}
					onAddRelationship={(anchor) =>
						editor.openRelationship({
							id: anchor.id,
							givenName: anchor.displayName,
							surname: null
						})}
					onRemoveLink={editor.removeLink}
					onRecordDeath={(id) =>
						editor.openRelationship(editor.anchorFor(id), { kind: 'record_death' })}
					onEndPartnership={(id) =>
						editor.openRelationship(editor.anchorFor(id), { kind: 'end_union' })}
					onEditUnion={editor.editUnion}
					onEndUnion={editor.endUnion}
					onRemoveAssertion={editor.removeAssertion}
					onChangeLinkType={editor.changeLinkType}
					onRemoveUnion={editor.removeUnion}
					onMergeUnion={editor.mergeUnion}
					mergeableUnionIds={editor.mergeableIds}
					partnershipLabels={editor.unionLabels}
					onDragRelate={editor.dragRelate}
					onExpandStub={expandStub}
					onCollapseStub={collapseStub}
				/>
			{/if}
			{#if isLoading}
				<!-- Held back a beat by the animation delay, so a quick load never flashes it. -->
				<div
					class="loading pointer-events-none absolute inset-x-0 top-4 z-30 flex justify-center"
					role="status"
				>
					<span
						class="flex items-center gap-2 rounded-full border border-stone-300 bg-[#fdfbf7] px-3 py-1 text-sm font-medium text-stone-700 shadow-md"
					>
						<Loader2 class="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
						Loading…
					</span>
				</div>
			{/if}
		</div>
	{:else}
		<div
			class="flex flex-1 flex-col items-center justify-center rounded-2xl border border-stone-200 bg-stone-100/60 p-10 text-center"
		>
			<p class="text-sm text-stone-700">This tree has no people yet.</p>
			<button
				type="button"
				onclick={editor.openAddPerson}
				class="mt-4 cursor-pointer rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-amber-50 hover:bg-emerald-700"
			>
				Add the first person
			</button>
		</div>
	{/if}
</div>

{#if selectedPersonId}
	<PersonDrawer
		page={drawerPage}
		{treeId}
		{role}
		error={drawerError}
		onClose={clearSelection}
		onSelectPerson={handleSelectPerson}
		{editor}
		{toasts}
		{marks}
	/>
{/if}

<style>
	.loading {
		animation: loading-in 150ms ease-out 200ms backwards;
	}
	@keyframes loading-in {
		from {
			opacity: 0;
		}
	}
</style>
