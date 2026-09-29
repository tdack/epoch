/**
 * Zod schemas for transport-layer request payloads.
 *
 * These guard the boundary between the HTTP layer and the domain/services so
 * that malformed JSON never reaches a service. They mirror the domain types in
 * `relationship-sentence.ts` and the neutral genealogy model; where they
 * differ, the transport shape is the more permissive one (trimming and
 * normalization stay in the service).
 */

import { z } from 'zod';
import { END_EVENT_TYPES, ENDED_UNION_STATUSES, UNION_EVENT_TYPE_LIST } from '../../shared/union-events';

/** A tree-scoped record id (opaque, but must be a non-empty string). */
export const idSchema = z.string().min(1);

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

export const parentRoleSchema = z.enum(['parent', 'mother', 'father']);

// Literal tuple preserves the union of the five neutral relationship types.
export const parentChildTypeSchema = z.enum([
	'biological',
	'adoptive',
	'foster',
	'guardian',
	'unknown'
]);

/**
 * Discriminated union over the relationship intents the UI can submit. Field
 * shapes mirror `RelationshipIntent`; `unionLabel` is null or a string.
 */
export const relationshipIntentSchema = z.discriminatedUnion('kind', [
	z.object({
		kind: z.literal('add_parent'),
		child: personRefSchema,
		parent: personRefSchema,
		type: parentChildTypeSchema,
		role: parentRoleSchema,
		unionLabel: nullableText
	}),
	z.object({
		kind: z.literal('add_child'),
		parent: personRefSchema,
		child: personRefSchema,
		type: parentChildTypeSchema,
		unionLabel: nullableText
	}),
	z.object({
		kind: z.literal('add_partner'),
		person: personRefSchema,
		partner: personRefSchema,
		unionLabel: nullableText
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

export const individualCreateSchema = z.object({
	givenName: optionalText,
	surname: optionalText,
	sex: z.enum(['M', 'F', 'U']).default('U'),
	birthDate: optionalText,
	birthPlace: optionalText,
	deathDate: optionalText,
	deathPlace: optionalText
});

export const individualUpdateSchema = individualCreateSchema
	.partial()
	.extend({
		version: versionSchema
	});

export const exportBodySchema = z.object({
	treeId: idSchema,
	format: z.enum(['gedcom551', 'gedcom7']).optional()
});

/** Derived TypeScript types for validated payloads. */
export type TreeCreateInput = z.infer<typeof treeCreateSchema>;
export type IndividualCreateInput = z.infer<typeof individualCreateSchema>;
export type IndividualUpdateInput = z.infer<typeof individualUpdateSchema>;
export type RelationshipPayloadInput = z.infer<typeof relationshipPayloadSchema>;
export type RelationshipDeleteInput = z.infer<typeof relationshipDeleteSchema>;
export type ImpactRequestInput = z.infer<typeof impactRequestSchema>;
export type UnionMergeInput = z.infer<typeof unionMergeSchema>;
export type UnionUpdateInput = z.infer<typeof unionUpdateSchema>;
export type ExportBodyInput = z.infer<typeof exportBodySchema>;
