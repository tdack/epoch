/**
 * Zod schemas for transport-layer request payloads.
 *
 * These guard the boundary between the HTTP layer and the domain/services so
 * that malformed JSON never reaches a service. They mirror the domain types in
 * `relationship-sentence.ts` and the neutral genealogy model; where they
 * differ, the transport shape is the more permissive one (trimming and
 * normalization stay in the service).
 */

import { MAX_DISMISSAL_REASON_LENGTH } from '../../shared/quality';
import { TREE_ROLES } from '../../shared/roles';
import {
	MAX_MAX_ALIVE_YEARS,
	MIN_MAX_ALIVE_YEARS,
	PERSON_PRIVACY_VALUES
} from '../../shared/privacy';
import { z } from 'zod';
import { LAYOUT_MODE_VALUES } from '../../shared/view-mode';
import {
	END_EVENT_TYPES,
	ENDED_UNION_STATUSES,
	UNION_EVENT_TYPE_LIST
} from '../../shared/union-events';
import { SEX_VALUES } from '../../shared/sex';
import { isFactType } from '../../shared/fact-types';
import { isNameType } from '../../shared/name-types';
import { CITATION_SUBJECT_KIND_VALUES } from '../../shared/evidence';
import { NOTE_SUBJECT_KIND_VALUES } from '../../shared/notes';
import {
	MAX_TASK_DETAILS_LENGTH,
	MAX_TASK_TITLE_LENGTH,
	TASK_STATUS_VALUES,
	TASK_SUBJECT_KIND_VALUES,
	isDueDate
} from '../../shared/tasks';

/** A tree-scoped record id (opaque, but must be a non-empty string). */
const idSchema = z.string().min(1);

/** Optional free-text field; empty strings are treated as absent by callers. */
const optionalText = z.string().trim().nullish();

/** Nullable free-text field matching a `string | null` domain field. */
const nullableText = z.string().trim().nullable();

const personRefSchema = z.object({
	id: idSchema,
	givenName: nullableText,
	surname: nullableText,
	isNew: z.boolean().optional()
});

/** A version read from a DTO and sent back on an update; never defaulted, or a stale save would slip through. */
const versionSchema = z.number().int().nonnegative();

const endedStatusSchema = z.enum(ENDED_UNION_STATUSES);
const endEventTypeSchema = z.enum(END_EVENT_TYPES);
const unionEventTypeSchema = z.enum(UNION_EVENT_TYPE_LIST);

const parentRoleSchema = z.enum(['parent', 'mother', 'father']);

// Literal tuple preserves the union of the five neutral relationship types.
const parentChildTypeSchema = z.enum(['biological', 'adoptive', 'foster', 'guardian', 'unknown']);

/**
 * Discriminated union over the relationship intents the UI can submit. Field
 * shapes mirror `RelationshipIntent`; `unionLabel` is null or a string.
 */
const relationshipIntentSchema = z.discriminatedUnion('kind', [
	z.object({
		kind: z.literal('add_parent'),
		child: personRefSchema,
		parent: personRefSchema,
		type: parentChildTypeSchema,
		role: parentRoleSchema,
		unionLabel: nullableText,
		unionId: idSchema.nullable().optional()
	}),
	z.object({
		kind: z.literal('add_child'),
		parent: personRefSchema,
		child: personRefSchema,
		type: parentChildTypeSchema,
		unionLabel: nullableText,
		unionId: idSchema.nullable().optional()
	}),
	z.object({
		kind: z.literal('add_sibling'),
		person: personRefSchema,
		sibling: personRefSchema,
		parentIds: z.array(idSchema).min(1).max(10),
		type: parentChildTypeSchema
	}),
	z.object({
		kind: z.literal('add_partner'),
		person: personRefSchema,
		partner: personRefSchema,
		unionLabel: nullableText,
		unionId: idSchema.nullable().optional()
	}),
	z.object({
		kind: z.literal('change_link_type'),
		parent: personRefSchema,
		child: personRefSchema,
		fromType: parentChildTypeSchema,
		toType: parentChildTypeSchema
	}),
	z.object({
		kind: z.literal('record_death'),
		person: personRefSchema,
		dateText: nullableText,
		place: nullableText,
		personVersion: versionSchema.optional()
	}),
	z.object({
		kind: z.literal('end_union'),
		person: personRefSchema,
		unionId: idSchema.nullable(),
		status: endedStatusSchema,
		event: z
			.object({ type: endEventTypeSchema, dateText: nullableText, place: nullableText })
			.nullable(),
		unionVersion: versionSchema.optional()
	})
]);

export const relationshipPayloadSchema = z.object({
	intent: relationshipIntentSchema
});

/**
 * A destructive relationship command submitted directly (line/union deletion
 * from the canvas). Restricted to the non-destructive-to-people commands.
 */
export const relationshipDeleteSchema = z.discriminatedUnion('kind', [
	z.object({
		kind: z.literal('remove_parent_child'),
		parentId: idSchema,
		childId: idSchema,
		type: parentChildTypeSchema
	}),
	z.object({
		kind: z.literal('remove_partner_from_union'),
		unionId: idSchema,
		personId: idSchema,
		expectedVersion: versionSchema.optional()
	}),
	z.object({
		kind: z.literal('destroy_union'),
		unionId: idSchema,
		expectedVersion: versionSchema.optional()
	})
]);

/** What the impact endpoint previews: any removal, deleting a person, or deleting the whole tree. */
export const impactRequestSchema = z.discriminatedUnion('kind', [
	...relationshipDeleteSchema.options,
	z.object({ kind: z.literal('delete_person'), personId: idSchema }),
	z.object({ kind: z.literal('delete_tree') })
]);

/** The partnership editor's save: status and the events it manages, against the version it loaded. */
export const unionUpdateSchema = z.object({
	version: versionSchema,
	status: z.enum(['active', ...ENDED_UNION_STATUSES]).optional(),
	events: z
		.array(
			z.object({
				id: idSchema.nullable(),
				type: unionEventTypeSchema,
				dateText: nullableText,
				place: nullableText
			})
		)
		.optional()
});

/** Merge partnerships between the same people; `isPreview` asks for the impact and conflicts, writing nothing. */
export const unionMergeSchema = z.object({
	survivorId: idSchema,
	mergedIds: z.array(idSchema).min(1),
	expectedVersions: z.record(idSchema, versionSchema).optional(),
	keep: z
		.object({
			status: idSchema.optional(),
			events: z.record(z.string().min(1), idSchema).optional()
		})
		.optional(),
	isPreview: z.boolean().optional()
});

export const treeCreateSchema = z.object({
	name: z.string().trim().min(1, 'Tree name is required'),
	description: optionalText
});

export const treeRenameSchema = z.object({
	name: z.string().trim().min(1, 'Tree name is required').max(200),
	version: versionSchema
});

export const individualCreateSchema = z.object({
	givenName: optionalText,
	surname: optionalText,
	sex: z.enum(SEX_VALUES).default('U'),
	birthDate: optionalText,
	birthPlace: optionalText,
	deathDate: optionalText,
	deathPlace: optionalText
});

export const individualUpdateSchema = individualCreateSchema.partial().extend({
	version: versionSchema
});

export const exportBodySchema = z.object({
	treeId: idSchema,
	format: z.enum(['gedcom551', 'gedcom7']).optional(),
	shouldCompress: z.boolean().optional()
});

// ---- Facts (Phase 3 fact editor) ----

const factTypeSchema = z.string().refine(isFactType, { message: 'not a fact type' });

/** A fact as the form sends it: every field present, empty ones null. */
export const factCreateSchema = z.object({
	type: factTypeSchema,
	dateText: nullableText.default(null),
	place: nullableText.default(null),
	value: nullableText.default(null),
	cause: nullableText.default(null),
	age: nullableText.default(null),
	notes: nullableText.default(null)
});

/** Only the fields to change; absent leaves a field alone, null clears it. */
export const factUpdateSchema = z.object({
	version: versionSchema,
	type: factTypeSchema.optional(),
	dateText: nullableText.optional(),
	place: nullableText.optional(),
	value: nullableText.optional(),
	cause: nullableText.optional(),
	age: nullableText.optional(),
	notes: nullableText.optional()
});

export const factReorderSchema = z.object({ orderedFactIds: z.array(idSchema).max(500) });

/** A preview of a fact change: the same commands the writes take, minus the ids the server mints. */
export const factImpactSchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('create_fact'), personId: idSchema, fact: factCreateSchema }),
	z.object({
		kind: z.literal('update_fact'),
		factId: idSchema,
		version: versionSchema.optional(),
		fact: factUpdateSchema.omit({ version: true })
	}),
	z.object({ kind: z.literal('delete_fact'), factId: idSchema, version: versionSchema.optional() })
]);

// ---- Places (ADR-019) ----

/** The text every fact at a place will carry; a name another place has makes it a merge into that place. */
export const placeRewriteSchema = z.object({ name: z.string().trim().min(1).max(200) });

/** Dismissing a data-quality finding: the finding's key, and why it is fine. */
export const qualityDismissSchema = z.object({
	key: z.string().min(1).max(2000),
	reason: z.string().trim().min(1).max(MAX_DISMISSAL_REASON_LENGTH)
});

/** Merging a person (the path names the one that stays): who is folded in, what to keep where they differ, and the versions the review showed. */
export const personMergeSchema = z.object({
	mergedId: z.string().min(1),
	keep: z.object({ sex: z.enum(['survivor', 'merged']).optional() }).optional(),
	expectedVersions: z.record(z.string(), z.number().int()).optional()
});

// ---- Names (Phase 3, S6) ----

const nameTypeSchema = z.string().refine(isNameType, { message: 'not a name type' });

/** A name as the form sends it: every field present, empty ones null. */
export const nameCreateSchema = z.object({
	type: nameTypeSchema,
	givenName: nullableText.default(null),
	surname: nullableText.default(null),
	prefix: nullableText.default(null),
	suffix: nullableText.default(null),
	nickname: nullableText.default(null),
	surnamePrefix: nullableText.default(null),
	dateText: nullableText.default(null),
	unionId: idSchema.nullable().default(null),
	isPreferred: z.boolean().default(false)
});

/** Only the fields to change; absent leaves a field alone, null clears it. */
export const nameUpdateSchema = z.object({
	version: versionSchema,
	type: nameTypeSchema.optional(),
	givenName: nullableText.optional(),
	surname: nullableText.optional(),
	prefix: nullableText.optional(),
	suffix: nullableText.optional(),
	nickname: nullableText.optional(),
	surnamePrefix: nullableText.optional(),
	dateText: nullableText.optional(),
	unionId: idSchema.nullable().optional()
});

export const nameReorderSchema = z.object({ orderedNameIds: z.array(idSchema).max(200) });
export const namePreferredSchema = z.object({
	nameId: idSchema,
	version: versionSchema.optional()
});

/** A preview of a name change: the same commands the writes take, minus the ids the server mints. */
export const nameImpactSchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('create_name'), personId: idSchema, name: nameCreateSchema }),
	z.object({
		kind: z.literal('update_name'),
		nameId: idSchema,
		version: versionSchema.optional(),
		name: nameUpdateSchema.omit({ version: true })
	}),
	z.object({ kind: z.literal('delete_name'), nameId: idSchema, version: versionSchema.optional() }),
	z.object({
		kind: z.literal('set_preferred_name'),
		personId: idSchema,
		nameId: idSchema,
		version: versionSchema.optional()
	})
]);

/** A manager's override on one person, and the tree's privacy settings (ADR-015). */
export const personPrivacySchema = z.object({
	privacy: z.enum(PERSON_PRIVACY_VALUES),
	version: versionSchema.optional()
});
/** A view setting, or null to clear it. */
export const viewModeSchema = z.object({ mode: z.enum(LAYOUT_MODE_VALUES).nullable() });
export const privacySettingsSchema = z
	.object({
		maxAliveYears: z.number().int().min(MIN_MAX_ALIVE_YEARS).max(MAX_MAX_ALIVE_YEARS),
		shouldShowPrivateStructure: z.boolean()
	})
	.partial()
	.refine(
		(v) => v.maxAliveYears !== undefined || v.shouldShowPrivateStructure !== undefined,
		'Nothing to change'
	);

/** Member administration (ADR-016). The role is checked against the caller's own in the service. */
const memberRoleSchema = z.enum(TREE_ROLES);
export const inviteMemberSchema = z.object({
	email: z.string().trim().min(3).max(254),
	role: memberRoleSchema
});
export const changeMemberRoleSchema = z.object({ role: memberRoleSchema, version: versionSchema });

// ---- Sources, repositories and citations (ADR-028) ----

const sourceTextSchema = z.string().trim().max(10_000).nullable();
const shortTextSchema = z.string().trim().max(500).nullable();

/** A source as the form sends it: every field present, empty ones null. */
export const sourceCreateSchema = z.object({
	title: shortTextSchema.default(null),
	author: shortTextSchema.default(null),
	publication: shortTextSchema.default(null),
	abbreviation: z.string().trim().max(100).nullable().default(null),
	text: sourceTextSchema.default(null)
});

export const sourceUpdateSchema = z.object({
	version: versionSchema,
	title: shortTextSchema.optional(),
	author: shortTextSchema.optional(),
	publication: shortTextSchema.optional(),
	abbreviation: z.string().trim().max(100).nullable().optional(),
	text: sourceTextSchema.optional()
});

export const sourceMergeSchema = z.object({
	mergedIds: z.array(idSchema).min(1).max(20),
	expectedVersions: z.record(z.string(), z.number().int()).optional()
});

export const repositoryCreateSchema = z.object({
	name: z.string().trim().min(1).max(500),
	address: sourceTextSchema.default(null)
});

export const repositoryUpdateSchema = z.object({
	version: versionSchema,
	name: z.string().trim().min(1).max(500).optional(),
	address: sourceTextSchema.optional()
});

export const sourceRepositoryLinkSchema = z.object({
	repositoryId: idSchema,
	callNumber: shortTextSchema.default(null)
});

export const sourceRepositoryUpdateSchema = z.object({
	version: versionSchema,
	callNumber: shortTextSchema
});

const citationSubjectSchema = z.object({
	kind: z.enum(CITATION_SUBJECT_KIND_VALUES),
	id: idSchema
});

const citationQualitySchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

/** A citation as the form sends it: a source, and the optional where, how reliable, when and words. */
export const citationCreateSchema = z.object({
	subject: citationSubjectSchema,
	sourceId: idSchema,
	page: shortTextSchema.default(null),
	quality: citationQualitySchema.nullable().default(null),
	entryDate: z.string().trim().max(200).nullable().default(null),
	text: sourceTextSchema.default(null)
});

/** Only the fields to change; absent leaves a field alone, null clears it. */
export const citationUpdateSchema = z.object({
	version: versionSchema,
	sourceId: idSchema.optional(),
	page: shortTextSchema.optional(),
	quality: citationQualitySchema.nullable().optional(),
	entryDate: z.string().trim().max(200).nullable().optional(),
	text: sourceTextSchema.optional()
});

export const citationReorderSchema = z.object({
	subject: citationSubjectSchema,
	orderedCitationIds: z.array(idSchema).max(500)
});

/** A preview of an evidence change: the commands the writes take, minus the ids the server mints. */
export const evidenceImpactSchema = z.discriminatedUnion('kind', [
	z.object({
		kind: z.literal('delete_source'),
		sourceId: idSchema,
		version: versionSchema.optional(),
		shouldRemoveCitations: z.boolean().optional()
	}),
	z.object({
		kind: z.literal('merge_sources'),
		survivorId: idSchema,
		mergedIds: z.array(idSchema).min(1).max(20)
	}),
	z.object({
		kind: z.literal('remove_citation'),
		citationId: idSchema,
		version: versionSchema.optional()
	}),
	z.object({
		kind: z.literal('delete_repository'),
		repositoryId: idSchema,
		version: versionSchema.optional()
	})
]);

// ---- Notes (ADR-029) ----

const noteSubjectSchema = z.object({ kind: z.enum(NOTE_SUBJECT_KIND_VALUES), id: idSchema });
const noteTextSchema = z.string().trim().min(1, 'A note needs some text').max(20_000);

/** A note on a record: its words written there, or an existing shared note to attach. */
export const noteLinkCreateSchema = z
	.object({
		subject: noteSubjectSchema,
		text: noteTextSchema.optional(),
		noteId: idSchema.optional()
	})
	.refine((v) => (v.text === undefined) !== (v.noteId === undefined), {
		message: 'Send either the words of the note or the shared note to attach'
	});

export const noteLinkUpdateSchema = z.object({ version: versionSchema, text: noteTextSchema });
export const noteLinkShareSchema = z.object({ version: versionSchema.optional() });

export const noteReorderSchema = z.object({
	subject: noteSubjectSchema,
	orderedAttachmentIds: z.array(idSchema).max(500)
});

export const sharedNoteCreateSchema = z.object({
	text: noteTextSchema,
	mime: z.string().trim().max(100).nullable().default(null),
	language: z.string().trim().max(35).nullable().default(null)
});

/** Only the fields to change; absent leaves a field alone, null clears it. */
export const sharedNoteUpdateSchema = z.object({
	version: versionSchema,
	text: noteTextSchema.optional(),
	mime: z.string().trim().max(100).nullable().optional(),
	language: z.string().trim().max(35).nullable().optional()
});

export const noteMergeSchema = z.object({
	mergedIds: z.array(idSchema).min(1).max(20),
	expectedVersions: z.record(z.string(), z.number().int()).optional()
});

/** A preview of a note change: the commands the writes take, minus the ids the server mints. */
export const noteImpactSchema = z.discriminatedUnion('kind', [
	z.object({
		kind: z.literal('delete_shared_note'),
		noteId: idSchema,
		version: versionSchema.optional(),
		shouldDetach: z.boolean().optional()
	}),
	z.object({
		kind: z.literal('merge_notes'),
		survivorId: idSchema,
		mergedIds: z.array(idSchema).min(1).max(20)
	}),
	z.object({
		kind: z.literal('remove_note'),
		attachmentId: idSchema,
		version: versionSchema.optional()
	})
]);

// ---- Research tasks (ADR-029) ----

const taskTitleSchema = z.string().trim().min(1, 'A task needs a title').max(MAX_TASK_TITLE_LENGTH);
const taskDetailsSchema = z.string().trim().max(MAX_TASK_DETAILS_LENGTH).nullable();
const taskDueSchema = z
	.string()
	.refine(isDueDate, { message: 'A due date is a calendar date, such as 2027-03-31' })
	.nullable();

/** A task as the form sends it: a title, and the optional rest; it may be about one record and one finding. */
export const taskCreateSchema = z.object({
	title: taskTitleSchema,
	details: taskDetailsSchema.default(null),
	status: z.enum(TASK_STATUS_VALUES).default('open'),
	assigneeId: idSchema.nullable().default(null),
	dueDate: taskDueSchema.default(null),
	subject: z
		.object({ kind: z.enum(TASK_SUBJECT_KIND_VALUES), id: idSchema })
		.nullable()
		.default(null),
	findingKey: z.string().min(1).max(2000).nullable().default(null)
});

/** Only the fields to change; absent leaves a field alone, null clears an optional one. */
export const taskUpdateSchema = z.object({
	version: versionSchema,
	title: taskTitleSchema.optional(),
	details: taskDetailsSchema.optional(),
	status: z.enum(TASK_STATUS_VALUES).optional(),
	assigneeId: idSchema.nullable().optional(),
	dueDate: taskDueSchema.optional()
});

/** The tasks page's filters, all optional: open tasks by default. */
export const taskListQuerySchema = z.object({
	status: z.enum([...TASK_STATUS_VALUES, 'all']).optional(),
	mine: z.enum(['true', 'false']).optional(),
	subjectKind: z.enum(TASK_SUBJECT_KIND_VALUES).optional(),
	subjectId: idSchema.optional(),
	linked: z.enum([...TASK_SUBJECT_KIND_VALUES, 'none']).optional(),
	offset: z.string().optional(),
	limit: z.string().optional()
});

/** A preview of deleting a task. */
export const taskImpactSchema = z.object({ taskId: idSchema, version: versionSchema.optional() });
