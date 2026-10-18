/**
 * Zod schemas for transport-layer request payloads.
 *
 * These guard the boundary between the HTTP layer and the domain/services so
 * that malformed JSON never reaches a service. They mirror the domain types in
 * `relationship-sentence.ts` and the neutral genealogy model; where they
 * differ, the transport shape is the more permissive one (trimming and
 * normalization stay in the service).
 */

import { MAX_BULK_DISMISSALS, MAX_DISMISSAL_REASON_LENGTH } from '../../shared/quality';
import { isValidTreeSlug } from '../../shared/tree-slug';
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

/**
 * A field GEDCOM writes on one line must not carry a terminator: on export it would forge a second
 * line, which a reader takes for a new record. Multi-line-capable text (a `NOTE`) keeps its breaks.
 */
const hasNoLineBreak = (value: string | null | undefined) =>
	!/[\r\n\u2028\u2029]/.test(value ?? '');
const SINGLE_LINE_MESSAGE = 'Line breaks are not allowed in this field';

/** Optional single-line free text; empty strings are treated as absent by callers. */
const optionalSingleLine = z.string().trim().refine(hasNoLineBreak, SINGLE_LINE_MESSAGE).nullish();

/** Nullable single-line free text matching a `string | null` domain field. */
const nullableSingleLine = z.string().trim().refine(hasNoLineBreak, SINGLE_LINE_MESSAGE).nullable();

const personRefSchema = z.object({
	id: idSchema,
	givenName: nullableSingleLine,
	surname: nullableSingleLine,
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
		dateText: nullableSingleLine,
		place: nullableSingleLine,
		personVersion: versionSchema.optional()
	}),
	z.object({
		kind: z.literal('end_union'),
		person: personRefSchema,
		unionId: idSchema.nullable(),
		status: endedStatusSchema,
		event: z
			.object({ type: endEventTypeSchema, dateText: nullableSingleLine, place: nullableSingleLine })
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
				dateText: nullableSingleLine,
				place: nullableSingleLine
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
	name: z
		.string()
		.trim()
		.min(1, 'Tree name is required')
		.refine(hasNoLineBreak, SINGLE_LINE_MESSAGE),
	description: optionalText
});

export const treeRenameSchema = z.object({
	name: z
		.string()
		.trim()
		.min(1, 'Tree name is required')
		.max(200)
		.refine(hasNoLineBreak, SINGLE_LINE_MESSAGE),
	/** The address (ADR-045); null gives it up, so the tree is reached by its id. Omitted keeps it. */
	slug: z
		.string()
		.trim()
		.refine(
			isValidTreeSlug,
			'Use lower-case letters, digits and single hyphens, up to 60 characters'
		)
		.nullable()
		.optional(),
	/** Also serve the tree at its slug's subdomain. Omitted keeps the current setting. */
	isOnSubdomain: z.boolean().optional(),
	version: versionSchema
});

export const individualCreateSchema = z.object({
	givenName: optionalSingleLine,
	surname: optionalSingleLine,
	sex: z.enum(SEX_VALUES).default('U'),
	birthDate: optionalSingleLine,
	birthPlace: optionalSingleLine,
	deathDate: optionalSingleLine,
	deathPlace: optionalSingleLine
});

export const individualUpdateSchema = individualCreateSchema.partial().extend({
	version: versionSchema
});

export const exportBodySchema = z.object({
	// A tree id is a UUID; a non-UUID must be a 400 here, not a 500 from buildExportInstanceId.
	treeId: z.string().uuid(),
	/** Per click, so a retried async export reuses its instance instead of starting a second. */
	clientUuid: z.string().uuid(),
	format: z.enum(['gedcom551', 'gedcom7']).optional(),
	shouldCompress: z.boolean().optional()
});

/** The synchronous download's query. The tree id is validated here, so a non-UUID is a 400, never a 500. */
export const exportQuerySchema = z.object({
	treeId: z.string().uuid(),
	format: z.enum(['gedcom551', 'gedcom7']).optional(),
	package: z.enum(['gdz']).optional()
});

// ---- Facts (Phase 3 fact editor) ----

const factTypeSchema = z.string().refine(isFactType, { message: 'not a fact type' });

/*
 * Imported details are never validated on import, so an edit of an imported fact must not fail on a
 * GEDCOM spec limit (a 130-character agency, four phone lines, an unusual coordinate). These caps
 * are only a safety net against abuse; the spec's per-line and per-value limits are not enforced.
 */
const DETAIL_LINE_MAX_CHARS = 2000;
const DETAIL_TEXT_MAX_CHARS = 20000;
const detailSingleLine = z
	.string()
	.trim()
	.max(DETAIL_LINE_MAX_CHARS)
	.refine(hasNoLineBreak, SINGLE_LINE_MESSAGE)
	.nullable();
/** Several values, one per line (phone, email, fax, web) or a multi-line address. */
const detailText = z.string().trim().max(DETAIL_TEXT_MAX_CHARS).nullable();

const factDetailCreateFields = {
	address: detailText.default(null),
	classification: detailSingleLine.default(null),
	agency: detailSingleLine.default(null),
	phone: detailText.default(null),
	email: detailText.default(null),
	fax: detailText.default(null),
	web: detailText.default(null),
	latitude: detailSingleLine.default(null),
	longitude: detailSingleLine.default(null),
	religion: detailSingleLine.default(null)
};

const factDetailUpdateFields = {
	address: detailText.optional(),
	classification: detailSingleLine.optional(),
	agency: detailSingleLine.optional(),
	phone: detailText.optional(),
	email: detailText.optional(),
	fax: detailText.optional(),
	web: detailText.optional(),
	latitude: detailSingleLine.optional(),
	longitude: detailSingleLine.optional(),
	religion: detailSingleLine.optional()
};

// `place_extra` and `address_layout` are not in these schemas on purpose: zod strips unknown keys,
// so a request cannot write or clear the file's own lines, which only the import owns.

/** A fact as the form sends it: every field present, empty ones null. */
export const factCreateSchema = z.object({
	type: factTypeSchema,
	dateText: nullableSingleLine.default(null),
	place: nullableSingleLine.default(null),
	value: nullableSingleLine.default(null),
	cause: nullableSingleLine.default(null),
	age: nullableSingleLine.default(null),
	notes: nullableText.default(null),
	...factDetailCreateFields
});

/** Only the fields to change; absent leaves a field alone, null clears it. */
export const factUpdateSchema = z.object({
	version: versionSchema,
	type: factTypeSchema.optional(),
	dateText: nullableSingleLine.optional(),
	place: nullableSingleLine.optional(),
	value: nullableSingleLine.optional(),
	cause: nullableSingleLine.optional(),
	age: nullableSingleLine.optional(),
	notes: nullableText.optional(),
	...factDetailUpdateFields
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
/**
 * One finding (`key`) or several (`keys`) dismissed with one reason. `key` stays for a page loaded
 * before `keys` existed.
 */
export const qualityDismissSchema = z
	.object({
		key: z.string().min(1).max(2000).optional(),
		keys: z.array(z.string().min(1).max(2000)).min(1).max(MAX_BULK_DISMISSALS).optional(),
		reason: z.string().trim().min(1).max(MAX_DISMISSAL_REASON_LENGTH)
	})
	.refine((body) => (body.key === undefined) !== (body.keys === undefined), {
		message: 'Name the findings to dismiss with either key or keys'
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
	givenName: nullableSingleLine.default(null),
	surname: nullableSingleLine.default(null),
	prefix: nullableSingleLine.default(null),
	suffix: nullableSingleLine.default(null),
	nickname: nullableSingleLine.default(null),
	surnamePrefix: nullableSingleLine.default(null),
	dateText: nullableSingleLine.default(null),
	unionId: idSchema.nullable().default(null),
	isPreferred: z.boolean().default(false)
});

/** Only the fields to change; absent leaves a field alone, null clears it. */
export const nameUpdateSchema = z.object({
	version: versionSchema,
	type: nameTypeSchema.optional(),
	givenName: nullableSingleLine.optional(),
	surname: nullableSingleLine.optional(),
	prefix: nullableSingleLine.optional(),
	suffix: nullableSingleLine.optional(),
	nickname: nullableSingleLine.optional(),
	surnamePrefix: nullableSingleLine.optional(),
	dateText: nullableSingleLine.optional(),
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
export const defaultTreeSchema = z.object({ treeId: z.string().min(1).nullable() });
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
/** A short single-line field (`CALN`), where a terminator would forge a line. */
const singleLineShortTextSchema = shortTextSchema.refine(hasNoLineBreak, SINGLE_LINE_MESSAGE);

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
	callNumber: singleLineShortTextSchema.default(null)
});

export const sourceRepositoryUpdateSchema = z.object({
	version: versionSchema,
	callNumber: singleLineShortTextSchema
});

const citationSubjectSchema = z.object({
	kind: z.enum(CITATION_SUBJECT_KIND_VALUES),
	id: idSchema
});

const citationQualitySchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

/** `DATA.DATE` is one line. */
const entryDateSchema = z
	.string()
	.trim()
	.max(200)
	.refine(hasNoLineBreak, SINGLE_LINE_MESSAGE)
	.nullable();

/** A citation as the form sends it: a source, and the optional where, how reliable, when and words. */
export const citationCreateSchema = z.object({
	subject: citationSubjectSchema,
	sourceId: idSchema,
	page: shortTextSchema.default(null),
	quality: citationQualitySchema.nullable().default(null),
	entryDate: entryDateSchema.default(null),
	text: sourceTextSchema.default(null)
});

/**
 * The citation a fact or name form may send with its own save (ADR-028): the same fields, and the
 * subject is the record being saved, so the request does not name one.
 */
export const citationAttachSchema = citationCreateSchema.omit({ subject: true });

/** Only the fields to change; absent leaves a field alone, null clears it. */
export const citationUpdateSchema = z.object({
	version: versionSchema,
	sourceId: idSchema.optional(),
	page: shortTextSchema.optional(),
	quality: citationQualitySchema.nullable().optional(),
	entryDate: entryDateSchema.optional(),
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
/** A shared note's `MIME` and `LANG` each sit on one line. */
const mimeSchema = z
	.string()
	.trim()
	.max(100)
	.refine(hasNoLineBreak, SINGLE_LINE_MESSAGE)
	.nullable();
const languageSchema = z
	.string()
	.trim()
	.max(35)
	.refine(hasNoLineBreak, SINGLE_LINE_MESSAGE)
	.nullable();

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
	mime: mimeSchema.default(null),
	language: languageSchema.default(null)
});

/** Only the fields to change; absent leaves a field alone, null clears it. */
export const sharedNoteUpdateSchema = z.object({
	version: versionSchema,
	text: noteTextSchema.optional(),
	mime: mimeSchema.optional(),
	language: languageSchema.optional()
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

/** `treeId: null` withdraws the public tree. The name is deliberately not trimmed: it must match exactly. */
export const publicTreeSchema = z.object({
	treeId: z.string().min(1).nullable(),
	confirmName: z.string()
});

/** The Files listing: a tree to narrow to, a cursor from the last page, and a page size. */
export const fileListQuerySchema = z.object({
	treeId: idSchema.optional(),
	cursor: z.string().min(1).max(200).optional(),
	limit: z.coerce.number().int().min(1).max(100).optional()
});

/** A query that may narrow to one tree, shared by the usage and unlinked listings. */
export const fileTreeQuerySchema = z.object({ treeId: idSchema.optional() });

/** A rename: the tree the file is in, its new name, and the version the client last read. */
export const fileRenameSchema = z.object({
	treeId: idSchema,
	title: z.string(),
	version: versionSchema.optional()
});

/** An attach, or a move: the tree, the record to attach the file to, and the version read. */
export const fileAttachSchema = z.object({
	treeId: idSchema,
	entityId: idSchema,
	version: versionSchema.optional()
});

export const fileDetachSchema = z.object({ treeId: idSchema, version: versionSchema.optional() });

/** A delete names its tree in the query: DELETE carries no body. */
export const fileDeleteQuerySchema = z.object({ treeId: idSchema });

// ADR-054: colours reach a style attribute, so each one is a six-digit hex and nothing looser.
const colourSchema = z
	.string()
	.regex(/^#[0-9a-fA-F]{6}$/)
	.transform((colour) => colour.toLowerCase());
const sexColoursSchema = z.object({
	male: colourSchema,
	female: colourSchema,
	unknown: colourSchema
});
const tracePaletteSchema = z.object({
	trace: z.array(colourSchema).length(6),
	intersection: colourSchema
});
const focusColoursSchema = z.object({
	ancestor: colourSchema,
	descendant: colourSchema,
	partner: colourSchema
});

/** A change to a settings layer: a group replaces, `null` clears it, an absent key is left alone. */
export const settingsPatchSchema = z.object({
	sexColours: sexColoursSchema.nullable().optional(),
	tracePalette: tracePaletteSchema.nullable().optional(),
	focusColours: focusColoursSchema.nullable().optional(),
	isMotionReduced: z.boolean().nullable().optional()
});
/** The site default has no motion setting, so the install owner cannot set one for everyone. */
export const siteSettingsPatchSchema = settingsPatchSchema.omit({ isMotionReduced: true });
/** The versioned document stored per layer. Unknown keys are stripped on every read. */
export const settingsDocumentSchema = z.object({
	version: z.literal(1).optional(),
	sexColours: sexColoursSchema.optional(),
	tracePalette: tracePaletteSchema.optional(),
	focusColours: focusColoursSchema.optional(),
	isMotionReduced: z.boolean().optional()
});
