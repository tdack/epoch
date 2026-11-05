import { messageOf } from '#lib/components/feedback/error-message.js';
import { createSubmission } from '#lib/components/forms/submission.svelte.js';
import { dateFormatReader } from '#lib/components/date-format.js';
import { searchPeopleApi } from '#lib/api/lists.js';
import { planRelationshipApi, applyRelationshipApi } from '#lib/api/relationships.js';
import type { ConflictError } from '#lib/api/client.js';
import { namesWithBirth, personName } from '#lib/shared/person-name.js';
import type { Sex } from '#lib/shared/sex.js';
import { partnershipLabels } from '#lib/shared/partnership-labels.js';
import { checkDateText } from '#lib/shared/date-value.js';
import {
	SUGGESTED_END_EVENT,
	UNION_STATUS_LABELS,
	type EndedUnionStatus
} from '#lib/shared/union-events.js';
import type { ParentChildType } from '#lib/shared/relationship-model.js';
import type {
	ChangeSummary,
	RelationshipGraph,
	RelationshipIntent,
	ParentRole,
	PeopleSearchResult,
	RelationshipKind,
	RelationshipPlan,
	UnionEventType
} from '#lib/types/genealogy.js';
import { differingRows, storedText, type ConflictRow } from './conflict.js';

/** The modal's props the draft reads. Passed as a getter, because props change while the modal stays mounted. */
interface RelationshipDraftInputs {
	treeId: string;
	/** The person who is the anchor/subject of this relationship edit. */
	anchor: { id: string; givenName: string | null; surname: string | null };
	graph: RelationshipGraph;
	preselect: { id: string; givenName: string | null; surname: string | null } | null;
	initialKind: RelationshipKind;
	initialUnionId: string | null;
	onsaved: (change: ChangeSummary | null, plan: RelationshipPlan) => void;
	onrefresh: () => Promise<void>;
}

interface UnionOption {
	/** Null for "a new partnership" when adding a partner. */
	id: string | null;
	title: string;
	detail: string;
}

interface SiblingOption {
	key: string;
	parentIds: string[];
	title: string;
	detail: string;
}

export const typeOptions: Array<{ value: ParentChildType; label: string }> = [
	{ value: 'biological', label: 'Biological' },
	{ value: 'adoptive', label: 'Adoptive' },
	{ value: 'foster', label: 'Foster' },
	{ value: 'guardian', label: 'Guardian' },
	{ value: 'unknown', label: 'Unknown / other' }
];

export const roleOptions: Array<{ value: ParentRole; label: string }> = [
	{ value: 'parent', label: 'Parent' },
	{ value: 'mother', label: 'Mother' },
	{ value: 'father', label: 'Father' }
];

/**
 * The draft and submission state every section of the relationship dialog edits. One object, so
 * the per-intent sections can live in their own components without a prop per field.
 */
class RelationshipDraft {
	#inputs: () => RelationshipDraftInputs;
	#dateFormat = dateFormatReader();

	kind = $state<RelationshipKind>('add_parent');
	role = $state<ParentRole>('parent');
	type = $state<ParentChildType>('biological');
	searchQuery = $state('');
	results = $state<PeopleSearchResult[]>([]);
	selected = $state<PeopleSearchResult | null>(null);
	newGivenName = $state('');
	newSurname = $state('');
	newSex = $state<Sex>('U');
	isAddingNewPerson = $state(false);
	deathDate = $state('');
	deathPlace = $state('');
	chosenUnionId = $state<string | null>(null);
	/** The partnership the person picked for add child, add parent or add partner. Undefined: let the server choose. */
	unionOverride = $state<string | null | undefined>(undefined);
	endStatus = $state<EndedUnionStatus>('divorced');
	endEventType = $state<UnionEventType | ''>('DIV');
	endDate = $state('');
	endPlace = $state('');
	/** Which parents an added sibling shares. Undefined: the first option, the biological parents. */
	siblingOptionKey = $state<string | undefined>(undefined);
	plan = $state<RelationshipPlan | null>(null);
	isPlanning = $state(false);
	isSearching = $state(false);
	conflict = $state<ConflictError | null>(null);
	submission = createSubmission((_message, cause) => {
		this.conflict = cause;
	});

	constructor(inputs: () => RelationshipDraftInputs) {
		this.#inputs = inputs;
	}

	get treeId() {
		return this.#inputs().treeId;
	}
	get anchor() {
		return this.#inputs().anchor;
	}
	get graph() {
		return this.#inputs().graph;
	}

	resultLabels = $derived(namesWithBirth(this.results, personName, this.#dateFormat()));
	anchorPerson = $derived(this.graph.people.find((p) => p.id === this.anchor.id));
	anchorUnions = $derived(this.graph.unions.filter((u) => u.partnerIds.includes(this.anchor.id)));
	// With one partnership there is nothing to choose, and the graph may still be reloading when the
	// dialog opens, so the single one is derived rather than copied in at open time.
	effectiveUnionId = $derived(
		this.chosenUnionId ?? (this.anchorUnions.length === 1 ? this.anchorUnions[0].id : null)
	);
	chosenUnion = $derived(this.anchorUnions.find((u) => u.id === this.effectiveUnionId) ?? null);
	suggestedSurname = $derived(
		(this.kind === 'add_child' || this.kind === 'add_sibling') &&
			this.anchor.surname &&
			this.newSurname.trim() !== this.anchor.surname
			? this.anchor.surname
			: null
	);
	unionLabels = $derived(partnershipLabels(this.graph.unions, this.#dateFormat()));

	nameOf = (id: string) => this.graph.people.find((p) => p.id === id)?.displayName ?? id;

	#optionFor(union: RelationshipGraph['unions'][number]): UnionOption {
		const names = union.partnerIds.map(this.nameOf);
		const childCount = new Set(union.children.map((c) => c.childId)).size;
		const detail = [
			this.unionLabels.get(union.id)?.full,
			childCount === 1 ? '1 child' : `${childCount} children`,
			union.partnerIds.length < 2 ? 'one partner recorded' : null
		]
			.filter(Boolean)
			.join(' · ');
		return {
			id: union.id,
			title: names.length > 0 ? names.join(' and ') : 'Unknown partners',
			detail
		};
	}

	// A chooser is only worth showing when there is something to choose between. Add-partner always
	// offers "a new partnership" next to the ones still waiting for a partner, because filling the
	// wrong waiting one is exactly the mistake the chooser exists to prevent.
	unionOptions = $derived.by((): UnionOption[] => {
		if (this.kind === 'add_child') return this.anchorUnions.map((u) => this.#optionFor(u));
		if (this.kind === 'add_parent') {
			const ids = new Set(
				this.graph.parentChild
					.filter((l) => l.childId === this.anchor.id && l.unionId)
					.map((l) => l.unionId)
			);
			return this.graph.unions.filter((u) => ids.has(u.id)).map((u) => this.#optionFor(u));
		}
		if (this.kind === 'add_partner') {
			const waiting = this.anchorUnions
				.filter((u) => u.partnerIds.length === 1)
				.map((u) => this.#optionFor(u));
			return waiting.length > 0
				? [
						...waiting,
						{
							id: null,
							title: 'A new partnership',
							detail: 'Start a separate partnership with them'
						}
					]
				: [];
		}
		return [];
	});
	shouldShowUnionChooser = $derived(
		this.kind === 'add_partner' ? this.unionOptions.length > 0 : this.unionOptions.length > 1
	);
	selectedUnionId = $derived(
		this.unionOverride !== undefined
			? this.unionOverride
			: (this.plan?.unionChoice?.unionId ?? null)
	);
	unionChooserLegend = $derived(
		this.kind === 'add_parent'
			? 'Which parental family'
			: this.kind === 'add_partner'
				? 'Which partnership to fill'
				: 'Which partnership'
	);

	// A sibling is someone who shares a parent, so the choice is which of the person's parents. Whole
	// families come first, biological ones at the top, then each parent alone for a half-sibling.
	siblingOptions = $derived.by((): SiblingOption[] => {
		const groups = new Map<string, Array<{ parentId: string; type: ParentChildType }>>();
		for (const link of this.graph.parentChild) {
			if (link.childId !== this.anchor.id) continue;
			const key = link.unionId ?? 'direct';
			groups.set(key, [...(groups.get(key) ?? []), { parentId: link.parentId, type: link.type }]);
		}
		const typeLabel = (type: ParentChildType) =>
			typeOptions.find((t) => t.value === type)?.label.toLowerCase() ?? type;
		const whole = [...groups.entries()].map(
			([key, links]): SiblingOption & { isBiological: boolean } => {
				const parentIds = [...new Set(links.map((l) => l.parentId))];
				const types = [...new Set(links.map((l) => l.type))];
				return {
					key,
					parentIds,
					title: parentIds.map(this.nameOf).join(' and '),
					detail: `${parentIds.length > 1 ? 'Both parents' : 'One recorded parent'} · ${types.map(typeLabel).join(', ')}`,
					isBiological: types.every((t) => t === 'biological')
				};
			}
		);
		whole.sort((a, b) => Number(b.isBiological) - Number(a.isBiological));
		const halves = whole
			.filter((g) => g.parentIds.length > 1)
			.flatMap((g) =>
				g.parentIds.map((id) => ({
					key: `${g.key}:${id}`,
					parentIds: [id],
					title: `${this.nameOf(id)} only`,
					detail: 'A half-sibling: one shared parent'
				}))
			);
		return [...whole.map(({ isBiological: _isBiological, ...option }) => option), ...halves];
	});
	effectiveSiblingKey = $derived(this.siblingOptionKey ?? this.siblingOptions[0]?.key ?? null);
	siblingOption = $derived(
		this.siblingOptions.find((o) => o.key === this.effectiveSiblingKey) ?? null
	);

	// Only the date the current form shows counts; a stale value in a hidden field must not block saving.
	hasDateProblem = $derived(
		(this.kind === 'record_death' && !checkDateText(this.deathDate).isValid) ||
			(this.kind === 'end_union' &&
				Boolean(this.endEventType) &&
				!checkDateText(this.endDate).isValid)
	);
	canSave = $derived(
		Boolean(this.plan) &&
			this.plan!.commands.length > 0 &&
			!this.submission.isSaving &&
			!this.isPlanning &&
			!this.hasDateProblem
	);

	conflictRows = $derived.by((): ConflictRow[] => {
		const conflict = this.conflict;
		if (!conflict) return [];
		const current = conflict.details.current;
		if (conflict.details.entity === 'individual') {
			return differingRows([
				{ label: 'Death date', yours: this.deathDate, current: storedText(current.deathDate) },
				{ label: 'Death place', yours: this.deathPlace, current: storedText(current.deathPlace) }
			]);
		}
		const stored =
			(current.events as Array<{ type: string; dateText: string | null; place: string | null }>) ??
			[];
		const storedEnd = stored.find((e) => e.type === this.endEventType);
		return differingRows([
			{
				label: 'Status',
				yours: UNION_STATUS_LABELS[this.endStatus],
				current:
					UNION_STATUS_LABELS[current.status as keyof typeof UNION_STATUS_LABELS] ?? current.status
			},
			{ label: 'End date', yours: this.endDate, current: storedEnd?.dateText },
			{ label: 'End place', yours: this.endPlace, current: storedEnd?.place }
		]);
	});

	partnersLabel = (union: RelationshipGraph['unions'][number]) => {
		const others = union.partnerIds.filter((id) => id !== this.anchor.id).map(this.nameOf);
		return others.length > 0 ? `with ${others.join(' and ')}` : 'with an unknown partner';
	};

	selectKind(next: RelationshipKind) {
		this.kind = next;
		this.unionOverride = undefined;
	}

	reset() {
		const { initialKind, initialUnionId, preselect } = this.#inputs();
		this.kind = initialKind;
		this.role = 'parent';
		this.type = 'biological';
		this.searchQuery = '';
		this.results = [];
		this.selected = preselect
			? {
					id: preselect.id,
					givenName: preselect.givenName ?? null,
					surname: preselect.surname ?? null
				}
			: null;
		this.newGivenName = '';
		this.newSurname = '';
		this.newSex = 'U';
		this.isAddingNewPerson = false;
		this.deathDate = this.anchorPerson?.deathDate ?? '';
		this.deathPlace = '';
		// With several partnerships the person must pick, never a default.
		// A form opened from one partnership's own "+ Add" starts on it; otherwise the server chooses.
		this.unionOverride =
			initialUnionId &&
			(initialKind === 'add_child' || initialKind === 'add_parent' || initialKind === 'add_partner')
				? initialUnionId
				: undefined;
		this.siblingOptionKey = undefined;
		this.chosenUnionId = initialUnionId;
		this.endStatus = 'divorced';
		this.endEventType = 'DIV';
		this.endDate = '';
		this.endPlace = '';
		this.plan = null;
		this.submission.error = null;
		this.conflict = null;
	}

	pickStatus(status: EndedUnionStatus) {
		this.endStatus = status;
		this.endEventType = SUGGESTED_END_EVENT[status] ?? '';
	}

	async runSearch() {
		if (!this.searchQuery.trim()) {
			this.results = [];
			return;
		}
		this.isSearching = true;
		try {
			this.results = await searchPeopleApi(this.treeId, this.searchQuery);
		} catch (e) {
			this.submission.error = messageOf(e, '');
		} finally {
			this.isSearching = false;
		}
	}

	#otherPerson() {
		if (this.isAddingNewPerson) {
			if (!this.newGivenName.trim() && !this.newSurname.trim()) return null;
			return {
				id: 'new',
				givenName: this.newGivenName.trim() || null,
				surname: this.newSurname.trim() || null,
				isNew: true,
				sex: this.newSex
			};
		}
		return this.selected
			? { id: this.selected.id, givenName: this.selected.givenName, surname: this.selected.surname }
			: null;
	}

	#buildIntent(versionOverride?: { person?: number; union?: number }): RelationshipIntent | null {
		const { kind, anchor, type, role, unionOverride } = this;
		if (kind === 'record_death') {
			return {
				kind,
				person: anchor,
				dateText: this.deathDate.trim() || null,
				place: this.deathPlace.trim() || null,
				personVersion: versionOverride?.person ?? this.anchorPerson?.version
			};
		}
		if (kind === 'end_union') {
			const chosenUnion = this.chosenUnion;
			if (!chosenUnion) return null;
			return {
				kind,
				person: anchor,
				unionId: chosenUnion.id,
				status: this.endStatus,
				event: this.endEventType
					? {
							type: this.endEventType,
							dateText: this.endDate.trim() || null,
							place: this.endPlace.trim() || null
						}
					: null,
				unionVersion: versionOverride?.union ?? chosenUnion.version
			};
		}
		const other = this.#otherPerson();
		if (!other) return null;
		if (kind === 'add_partner')
			return { kind, person: anchor, partner: other, unionLabel: null, unionId: unionOverride };
		if (kind === 'add_sibling')
			return this.siblingOption
				? { kind, person: anchor, sibling: other, parentIds: this.siblingOption.parentIds, type }
				: null;
		if (kind === 'add_parent')
			return {
				kind,
				child: anchor,
				parent: other,
				type,
				role,
				unionLabel: null,
				unionId: unionOverride
			};
		return { kind, parent: anchor, child: other, type, unionLabel: null, unionId: unionOverride };
	}

	/** Call inside an `$effect` while the dialog is open; the returned cleanup drops a stale preview. */
	previewPlan(): (() => void) | undefined {
		const intent = this.#buildIntent();
		if (!intent) {
			this.plan = null;
			return;
		}
		let isStale = false;
		const timer = setTimeout(async () => {
			this.isPlanning = true;
			try {
				const next = await planRelationshipApi(this.treeId, intent);
				if (!isStale) {
					this.plan = next;
					this.submission.error = null;
				}
			} catch (e) {
				if (!isStale) {
					this.plan = null;
					this.submission.error = messageOf(e, '');
				}
			} finally {
				if (!isStale) this.isPlanning = false;
			}
		}, 250);
		return () => {
			isStale = true;
			clearTimeout(timer);
		};
	}

	async submit(versionOverride?: { person?: number; union?: number }) {
		const intent = this.#buildIntent(versionOverride);
		if (!intent) {
			this.submission.error =
				this.kind === 'end_union'
					? 'Choose which partnership to end.'
					: 'Select an existing person or enter a new person.';
			return;
		}
		await this.submission.submit(async () => {
			const saved = await applyRelationshipApi(this.treeId, intent);
			this.conflict = null;
			this.#inputs().onsaved(saved.change, saved.plan);
		}, '');
	}

	async reloadAfterConflict() {
		this.conflict = null;
		await this.#inputs().onrefresh();
		this.reset();
	}

	async reapplyAfterConflict() {
		if (!this.conflict) return;
		const version = this.conflict.details.currentVersion;
		await this.submit(
			this.conflict.details.entity === 'individual' ? { person: version } : { union: version }
		);
	}
}

export type { RelationshipDraft };

export function createRelationshipDraft(inputs: () => RelationshipDraftInputs) {
	return new RelationshipDraft(inputs);
}
