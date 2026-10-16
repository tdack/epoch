/**
 * Everything a tree screen does to the tree beyond reading it: add, edit and delete a person,
 * the relationship dialog, the partnership editor and merge, confirmed removals with their impact
 * summary, and undo. One instance serves every screen under a tree, so the tree, a person and a
 * partnership share the same dialogs and a dialog survives navigating between them.
 *
 * A screen tells the editor which graph it is showing (`graph`), because the dialogs read
 * versions, partnerships and names from it; the editor never loads a graph itself. After a change
 * it calls `refresh`, which reloads the screen's data, and then says what happened in a toast.
 */

import { differingRows, storedText } from '#lib/components/modals/conflict.js';
import { messageOf } from '#lib/components/feedback/error-message.js';
import type { ToastStore } from '#lib/components/feedback/toasts.svelte.js';
import { TOAST_TONES } from '#lib/components/feedback/toasts.svelte.js';
import type { RelationshipGraph } from '#lib/shared/relationship-graph.js';
import { partnershipLabels } from '#lib/shared/partnership-labels.js';
import { mergeCandidatesFor, mergeableUnionIds } from './merge-candidates.js';
import { isConflict, type ConflictError } from '#lib/api/client.js';
import {
	createPersonApi,
	deletePersonApi,
	fetchPersonPage,
	updatePersonApi
} from '#lib/api/people.js';
import {
	applyRelationshipApi,
	mergeUnionsApi,
	planRelationshipApi,
	previewImpactApi,
	removeRelationshipApi,
	undoApi,
	type ImpactRequest,
	type MergeUnionsRequest,
	type RelationshipDeleteCommand
} from '#lib/api/relationships.js';
import type { ParentChildType } from '#lib/shared/relationship-model.js';
import type {
	ChangeSummary,
	ImpactSummary,
	PersonFormData,
	RelationshipIntent,
	RelationshipKind
} from '#lib/types/genealogy.js';
import type { ChildAssertion, ChildEdge, PartnerEdge } from '#lib/tree-layout/index.js';

export interface PersonRef {
	id: string;
	givenName: string | null;
	surname: string | null;
}

/** How a relative is listed on the person they belong to; decides what can be done about them. */
type RelativeRelation = 'parent' | 'partner' | 'child' | 'sibling';

/** What happened to a relative, as the person chooses it from the trash button on their entry. */
export const RELATIVE_OUTCOMES = {
	REMOVE: 'remove',
	ENDED: 'ended',
	DIED: 'died',
	DELETE: 'delete'
} as const;
export type RelativeOutcome = (typeof RELATIVE_OUTCOMES)[keyof typeof RELATIVE_OUTCOMES];

export interface RelativeAction {
	relation: RelativeRelation;
	/** The person the relative is listed under. */
	owner: PersonRef;
	relative: PersonRef & { isDeceased: boolean };
	/** The partnership a partner is listed in. */
	unionId: string | null;
	/** The type of the parent link a parent or child is listed by. */
	type: ParentChildType | null;
}

export interface TreeEditorOptions {
	treeId: () => string;
	toasts: ToastStore;
	/** Reload what the current screen shows; resolves when the new data is in. */
	refresh: () => Promise<void>;
	/** A person was created from a dialog; screens usually open them. */
	onPersonCreated?: (personId: string) => void;
	/** A person was deleted; a screen about them has nothing left to show. */
	onPersonDeleted?: (personId: string) => void | Promise<void>;
}

interface PendingImpact {
	title: string;
	confirmLabel: string;
	impact: ImpactSummary | null;
	error: string | null;
	isConfirming: boolean;
	/** Toast text when the change comes back without a summary. */
	done: string;
	run: () => Promise<{ change: ChangeSummary | null }>;
}

/** The record the person form edits, in the shape it reads. */
export interface EditablePerson {
	id: string;
	name: string;
	givenName: string | null;
	surname: string | null;
	sex: string;
	/** Shown above the form when saving it could surprise (for example two recorded births). */
	notice: string | null;
	raw: {
		version: number;
		givenName: string | null;
		surname: string | null;
		sex: string;
		events: Array<{ type: string; dateRaw: string | null; place: string | null }>;
	};
}

const PERSON_FIELD_LABELS: Array<[keyof PersonFormData, string]> = [
	['givenName', 'Given names'],
	['surname', 'Surname'],
	['sex', 'Sex'],
	['birthDate', 'Birth date'],
	['birthPlace', 'Birth place'],
	['deathDate', 'Death date'],
	['deathPlace', 'Death place']
];

export class TreeEditor {
	/** The graph the current screen shows; the dialogs read versions, partnerships and names from it. */
	graph = $state<RelationshipGraph | null>(null);

	// Person form
	isPersonModalOpen = $state(false);
	personModalMode = $state<'add' | 'edit'>('add');
	personToEdit = $state<EditablePerson | null>(null);
	isSubmittingPerson = $state(false);
	personModalError = $state<string | null>(null);
	personConflict = $state<{
		error: ConflictError;
		form: PersonFormData;
		changes: Partial<PersonFormData>;
		personId: string;
	} | null>(null);

	// Relationship dialog
	isRelationshipModalOpen = $state(false);
	relationshipAnchor = $state<PersonRef | null>(null);
	relationshipKind = $state<RelationshipKind>('add_parent');
	relationshipUnionId = $state<string | null>(null);

	// Partnership editor and merge
	editingUnionId = $state<string | null>(null);
	mergingUnionId = $state<string | null>(null);

	pendingImpact = $state<PendingImpact | null>(null);

	/** The relative whose trash button was pressed; the dialog asks what happened to them. */
	relativeAction = $state<RelativeAction | null>(null);

	/** "1st partnership" and so on; computed over every partnership the graph holds. */
	unionLabels = $derived(this.graph ? partnershipLabels(this.graph.unions) : new Map());
	mergeableIds = $derived(this.graph ? mergeableUnionIds(this.graph.unions) : new Set<string>());
	mergeCandidates = $derived(
		this.graph && this.mergingUnionId
			? mergeCandidatesFor(this.graph.unions, this.mergingUnionId, this.unionLabels)
			: []
	);
	mergePartners = $derived(
		this.graph?.unions
			.find((u) => u.id === this.mergingUnionId)
			?.partnerIds.map((id) => this.nameOf(id))
			.join(' and ') ?? ''
	);
	editingUnion = $derived(this.graph?.unions.find((u) => u.id === this.editingUnionId) ?? null);

	constructor(private options: TreeEditorOptions) {}

	get treeId(): string {
		return this.options.treeId();
	}

	get toasts(): ToastStore {
		return this.options.toasts;
	}

	refresh = () => this.options.refresh();

	nameOf = (id: string): string => this.graph?.people.find((p) => p.id === id)?.displayName ?? id;

	anchorFor = (id: string): PersonRef => ({ id, givenName: this.nameOf(id), surname: null });

	// ---- After a change ----

	/** Reload, then say what happened, with Undo when the change can be undone. */
	afterChange = async (change: ChangeSummary | null, fallback: string) => {
		await this.refresh();
		this.toasts.push(change?.summary ?? fallback, {
			action: change?.isUndoable ? { label: 'Undo', run: this.undoLast } : undefined
		});
	};

	/**
	 * Run a change and report it: reload and toast what happened (with Undo) on success, and the
	 * server's own words as an error toast on failure. Answers whether it worked, for a caller that
	 * has more to do afterwards. A conflict here is only reported; the dialogs that can show a
	 * comparison handle theirs themselves.
	 */
	mutate = async (
		run: () => Promise<{ change: ChangeSummary | null }>,
		options: { done: string; failure: string }
	): Promise<boolean> => {
		try {
			const { change } = await run();
			await this.afterChange(change, options.done);
			return true;
		} catch (cause) {
			this.toasts.push(messageOf(cause, options.failure), { tone: TOAST_TONES.ERROR });
			return false;
		}
	};

	undoLast = async () => {
		try {
			const { undone } = await undoApi(this.treeId);
			await this.refresh();
			this.toasts.push(`Undid: ${undone.summary}`);
		} catch (e) {
			// Refusals arrive with a plain-language reason (a later change touched the same records).
			this.toasts.push(messageOf(e, 'Could not undo'), {
				tone: TOAST_TONES.ERROR,
				durationMs: 10_000
			});
		}
	};

	// ---- People ----

	openAddPerson = () => {
		this.personModalMode = 'add';
		this.personToEdit = null;
		this.personModalError = null;
		this.isSubmittingPerson = false;
		this.isPersonModalOpen = true;
	};

	/** Open the form on the person as stored now, so the version it sends is current. */
	openEditPerson = async (personId: string) => {
		try {
			const page = await fetchPersonPage(this.treeId, personId);
			const births = page.facts.filter((f) => f.type === 'BIRT').length;
			const deaths = page.facts.filter((f) => f.type === 'DEAT').length;
			const doubled = [births > 1 ? `${births} births` : '', deaths > 1 ? `${deaths} deaths` : '']
				.filter(Boolean)
				.join(' and ');
			this.personModalMode = 'edit';
			this.personToEdit = {
				id: page.person.id,
				name: page.person.displayName,
				givenName: page.person.givenName,
				surname: page.person.surname,
				sex: page.person.sex,
				// The form has one birth and one death field and edits the first of each; the others
				// are kept untouched and are edited from the person's page.
				notice: doubled
					? `This person has ${doubled} recorded. This form edits the first of each; edit the others from their page.`
					: null,
				raw: {
					version: page.person.version,
					givenName: page.person.givenName,
					surname: page.person.surname,
					sex: page.person.sex,
					events: [
						...(page.vitals.birth
							? [
									{
										type: 'BIRT',
										dateRaw: page.vitals.birth.dateText,
										place: page.vitals.birth.place
									}
								]
							: []),
						...(page.vitals.death
							? [
									{
										type: 'DEAT',
										dateRaw: page.vitals.death.dateText,
										place: page.vitals.death.place
									}
								]
							: [])
					]
				}
			};
			this.personModalError = null;
			this.isSubmittingPerson = false;
			this.isPersonModalOpen = true;
		} catch (e) {
			this.toasts.push(messageOf(e, 'Could not open the person'), { tone: TOAST_TONES.ERROR });
		}
	};

	private formValuesOf(record: EditablePerson | null): Record<string, string> {
		const raw = record?.raw;
		const event = (type: string) => raw?.events.find((e) => e.type === type);
		return {
			givenName: raw?.givenName ?? '',
			surname: raw?.surname ?? '',
			sex: raw?.sex ?? 'U',
			birthDate: event('BIRT')?.dateRaw ?? '',
			birthPlace: event('BIRT')?.place ?? '',
			deathDate: event('DEAT')?.dateRaw ?? '',
			deathPlace: event('DEAT')?.place ?? ''
		};
	}

	/** Only what the person actually changed in the form, so re-applying never overwrites what they did not touch. */
	private changedFields(
		form: PersonFormData,
		original: Record<string, string>
	): Partial<PersonFormData> {
		const changes: Record<string, unknown> = {};
		for (const [key] of PERSON_FIELD_LABELS) {
			const value = (form[key] ?? '') as string;
			if (value !== (original[key] ?? '')) changes[key] = form[key] ?? null;
		}
		return changes as Partial<PersonFormData>;
	}

	/** Rows for the conflict dialog: fields the person changed that now differ from what is stored. */
	personFormRows = (changes: Partial<PersonFormData>, current: Record<string, unknown>) =>
		differingRows(
			PERSON_FIELD_LABELS.filter(([key]) => key in changes).map(([key, label]) => ({
				label,
				yours: (changes[key] ?? '') as string,
				current: storedText(current[key])
			}))
		);

	private async savePersonEdit(
		personId: string,
		formData: Partial<PersonFormData>,
		version: number
	) {
		const { change } = await updatePersonApi(this.treeId, personId, formData, version);
		this.isPersonModalOpen = false;
		this.personConflict = null;
		await this.afterChange(change, 'Person saved');
	}

	savePerson = async (formData: PersonFormData) => {
		this.personModalError = null;
		this.isSubmittingPerson = true;
		try {
			if (this.personModalMode === 'add') {
				const created = await createPersonApi(this.treeId, formData);
				this.isPersonModalOpen = false;
				await this.afterChange(created.change, 'Person added');
				this.options.onPersonCreated?.(created.id);
			} else if (this.personToEdit) {
				await this.savePersonEdit(this.personToEdit.id, formData, this.personToEdit.raw.version);
			}
		} catch (err) {
			if (isConflict(err) && this.personToEdit) {
				this.personConflict = {
					error: err,
					form: formData,
					changes: this.changedFields(formData, this.formValuesOf(this.personToEdit)),
					personId: this.personToEdit.id
				};
			} else {
				console.error('Failed to save person', err);
				this.personModalError = messageOf(err, 'Failed to save person');
			}
		} finally {
			this.isSubmittingPerson = false;
		}
	};

	reapplyPersonEdit = async () => {
		const conflict = this.personConflict;
		if (!conflict) return;
		this.isSubmittingPerson = true;
		try {
			await this.savePersonEdit(
				conflict.personId,
				conflict.changes,
				conflict.error.details.currentVersion
			);
		} catch (err) {
			if (isConflict(err)) this.personConflict = { ...conflict, error: err };
			else {
				this.personConflict = null;
				this.personModalError = messageOf(err, 'Failed to save person');
			}
		} finally {
			this.isSubmittingPerson = false;
		}
	};

	reloadPersonEdit = async () => {
		const conflict = this.personConflict;
		this.personConflict = null;
		if (!conflict) return;
		this.isPersonModalOpen = false;
		await this.openEditPerson(conflict.personId);
	};

	// ---- Relationship dialog ----

	openRelationship = (
		anchor: PersonRef,
		options: { kind?: RelationshipKind; unionId?: string | null } = {}
	) => {
		this.relationshipAnchor = anchor;
		this.relationshipKind = options.kind ?? 'add_parent';
		this.relationshipUnionId = options.unionId ?? null;
		this.isRelationshipModalOpen = true;
	};

	relationshipSaved = async (
		change: ChangeSummary | null,
		plan: { sentence: string; commands: unknown[] }
	) => {
		this.isRelationshipModalOpen = false;
		await this.afterChange(
			change,
			plan.commands.length === 0 ? 'Nothing was changed' : plan.sentence
		);
	};

	// ---- Confirmed removals ----

	/**
	 * Show exactly what a destructive action would change and only run it once confirmed. The preview
	 * is the server's own plan, so the dialog cannot promise something the delete does not do.
	 */
	confirmWithImpact = async (options: {
		title: string;
		confirmLabel: string;
		preview: () => Promise<ImpactSummary>;
		run: () => Promise<{ change: ChangeSummary | null }>;
		done: string;
	}) => {
		this.pendingImpact = {
			title: options.title,
			confirmLabel: options.confirmLabel,
			impact: null,
			error: null,
			isConfirming: false,
			done: options.done,
			run: options.run
		};
		try {
			const impact = await options.preview();
			if (this.pendingImpact) this.pendingImpact.impact = impact;
		} catch (e) {
			if (this.pendingImpact)
				this.pendingImpact.error = messageOf(e, 'Could not check what this affects');
		}
	};

	runPendingImpact = async () => {
		const pending = this.pendingImpact;
		if (!pending) return;
		pending.isConfirming = true;
		pending.error = null;
		try {
			const { change } = await pending.run();
			this.pendingImpact = null;
			await this.afterChange(change, pending.done);
		} catch (e) {
			pending.isConfirming = false;
			if (isConflict(e)) {
				// Changed by someone else after the preview: show the current state rather than delete on stale information.
				this.pendingImpact = null;
				await this.refresh();
				this.toasts.push(`${e.message} Nothing was deleted. Review it and try again.`, {
					tone: TOAST_TONES.ERROR,
					durationMs: 10_000
				});
			} else {
				pending.error = messageOf(e, 'That did not work');
			}
		}
	};

	private requestImpactRemoval(
		command: RelationshipDeleteCommand,
		title: string,
		confirmLabel: string,
		done: string
	) {
		const treeId = this.treeId;
		void this.confirmWithImpact({
			title,
			confirmLabel,
			preview: () => previewImpactApi(treeId, command as ImpactRequest),
			run: () => removeRelationshipApi(treeId, command),
			done
		});
	}

	requestDeletePerson = (id: string) => {
		const treeId = this.treeId;
		const person = this.graph?.people.find((p) => p.id === id);
		void this.confirmWithImpact({
			title: `Delete ${person?.displayName ?? 'this person'}?`,
			confirmLabel: 'Delete person',
			preview: () => previewImpactApi(treeId, { kind: 'delete_person', personId: id }),
			run: async () => {
				const result = await deletePersonApi(treeId, id, person?.version);
				await this.options.onPersonDeleted?.(id);
				return result;
			},
			done: 'Person deleted'
		});
	};

	private unionVersion = (unionId: string) =>
		this.graph?.unions.find((u) => u.id === unionId)?.version;

	removeLink = (edge: PartnerEdge) =>
		this.requestImpactRemoval(
			{
				kind: 'remove_partner_from_union',
				unionId: edge.unionId,
				personId: edge.personId,
				expectedVersion: this.unionVersion(edge.unionId)
			},
			`Remove ${this.nameOf(edge.personId)} from this partnership?`,
			'Remove partner',
			'Partner removed'
		);

	/** Remove one parent's link from a merged (union, child) edge. */
	removeAssertion = (edge: ChildEdge, assertion: ChildAssertion) =>
		this.requestImpactRemoval(
			{
				kind: 'remove_parent_child',
				parentId: assertion.parentId,
				childId: edge.childId,
				type: assertion.type
			},
			`Remove ${this.nameOf(assertion.parentId)} as a parent of ${this.nameOf(edge.childId)}?`,
			'Remove link',
			'Link removed'
		);

	/** Change one parent's link to another type, after the preview sentence and records are shown. */
	changeLinkType = (edge: ChildEdge, assertion: ChildAssertion, toType: ParentChildType) => {
		const treeId = this.treeId;
		const intent: RelationshipIntent = {
			kind: 'change_link_type',
			parent: this.anchorFor(assertion.parentId),
			child: this.anchorFor(edge.childId),
			fromType: assertion.type,
			toType
		};
		void this.confirmWithImpact({
			title: `Change ${this.nameOf(assertion.parentId)}'s link to ${this.nameOf(edge.childId)}?`,
			confirmLabel: 'Change type',
			preview: async () => {
				const plan = await planRelationshipApi(treeId, intent);
				if (plan.commands.length === 0 || !plan.impact)
					throw new Error(plan.warnings[0]?.message ?? 'Nothing would change.');
				return plan.impact;
			},
			run: async () => {
				const saved = await applyRelationshipApi(treeId, intent);
				return { change: saved.change };
			},
			done: 'Link type changed'
		});
	};

	removeUnion = (unionId: string) => {
		const names = this.graph?.unions
			.find((u) => u.id === unionId)
			?.partnerIds.map(this.nameOf)
			.join(' and ');
		this.requestImpactRemoval(
			{ kind: 'destroy_union', unionId, expectedVersion: this.unionVersion(unionId) },
			`Delete the partnership${names ? ` of ${names}` : ''}?`,
			'Delete partnership',
			'Partnership deleted'
		);
	};

	// ---- Relatives on a person ----

	requestRelativeAction = (action: RelativeAction) => {
		this.relativeAction = action;
	};

	/**
	 * Carry out what the person said happened to a relative. Every branch ends in a step that shows
	 * its effect before saving: an impact preview for removals, the death and end-partnership forms
	 * for the others.
	 */
	chooseRelativeOutcome = (outcome: RelativeOutcome) => {
		const action = this.relativeAction;
		this.relativeAction = null;
		if (!action) return;
		const { relation, owner, relative, unionId, type } = action;
		if (outcome === RELATIVE_OUTCOMES.DELETE) return this.requestDeletePerson(relative.id);
		if (outcome === RELATIVE_OUTCOMES.DIED)
			return this.openRelationship(this.anchorFor(relative.id), { kind: 'record_death' });
		if (outcome === RELATIVE_OUTCOMES.ENDED && unionId)
			return this.openRelationship(this.anchorFor(owner.id), { kind: 'end_union', unionId });
		if (outcome !== RELATIVE_OUTCOMES.REMOVE) return;
		if (relation === 'partner' && unionId) {
			this.requestImpactRemoval(
				{
					kind: 'remove_partner_from_union',
					unionId,
					personId: relative.id,
					expectedVersion: this.unionVersion(unionId)
				},
				`Remove ${relative.givenName ?? 'this person'} as a partner of ${owner.givenName ?? 'this person'}?`,
				'Remove partner',
				'Partner removed'
			);
		} else if ((relation === 'parent' || relation === 'child') && type) {
			const isParent = relation === 'parent';
			this.requestImpactRemoval(
				{
					kind: 'remove_parent_child',
					parentId: isParent ? relative.id : owner.id,
					childId: isParent ? owner.id : relative.id,
					type
				},
				isParent
					? `Remove ${relative.givenName ?? 'this person'} as a parent of ${owner.givenName ?? 'this person'}?`
					: `Remove ${relative.givenName ?? 'this person'} as a child of ${owner.givenName ?? 'this person'}?`,
				'Remove link',
				'Link removed'
			);
		}
	};

	// ---- Partnerships ----

	editUnion = (unionId: string) => {
		this.editingUnionId = unionId;
	};

	mergeUnion = (unionId: string) => {
		this.mergingUnionId = unionId;
	};

	endUnion = (unionId: string) => {
		const partnerId = this.graph?.unions.find((u) => u.id === unionId)?.partnerIds[0];
		if (partnerId) this.openRelationship(this.anchorFor(partnerId), { kind: 'end_union', unionId });
	};

	unionSaved = async (change: ChangeSummary | null) => {
		this.editingUnionId = null;
		await this.afterChange(change, 'Partnership saved');
	};

	runMerge = async (request: MergeUnionsRequest) => {
		try {
			const { change } = await mergeUnionsApi(this.treeId, request);
			this.mergingUnionId = null;
			await this.afterChange(change, 'Partnerships merged');
		} catch (e) {
			if (!isConflict(e)) throw e;
			// A partnership changed after the dialog loaded it: show the current state instead of merging on stale information.
			this.mergingUnionId = null;
			await this.refresh();
			this.toasts.push(`${e.message} Nothing was merged. Review it and try again.`, {
				tone: TOAST_TONES.ERROR,
				durationMs: 10_000
			});
		}
	};
}
