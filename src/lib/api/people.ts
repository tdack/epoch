import type {
	ChangeResponse,
	ImpactResponse,
	PersonWriteResponse
} from '#lib/shared/api-contracts.js';
import type { PersonFormData, ChangeSummary, ImpactSummary } from '#lib/types/genealogy.js';
import type { PersonPageDto } from '#lib/shared/person-page.js';
import type { CitationInput } from '#lib/shared/evidence.js';
import type { FactInput } from '#lib/shared/fact-types.js';
import type { NameInput } from '#lib/shared/name-types.js';
import type { PersonPrivacy, PrivacySettingsDto } from '#lib/shared/privacy.js';
import type { PersonMergeChoices, PersonMergeReviewDto } from '#lib/shared/person-merge.js';
import { call, json, path } from './client.js';

export async function createPersonApi(
	treeId: string,
	data: PersonFormData
): Promise<{ id: string; change: ChangeSummary | null }> {
	const res = await call<PersonWriteResponse>(
		path`/api/trees/${treeId}/people`,
		json('POST', data),
		'Failed to add individual.'
	);
	return { id: res.individual.id, change: res.change };
}

/** `version` is the person's version when the form was opened; a newer stored version is a conflict. */
export async function updatePersonApi(
	treeId: string,
	personId: string,
	data: Partial<PersonFormData>,
	version: number
): Promise<{ change: ChangeSummary | null }> {
	const res = await call<ChangeResponse>(
		path`/api/trees/${treeId}/people/${personId}`,
		json('PUT', { ...data, version }),
		'Failed to update person.'
	);
	return { change: res.change };
}

export async function deletePersonApi(
	treeId: string,
	personId: string,
	version: number | undefined
): Promise<{ change: ChangeSummary | null }> {
	const query = version === undefined ? '' : `?version=${version}`;
	const res = await call<ChangeResponse>(
		path`/api/trees/${treeId}/people/${personId}` + query,
		{ method: 'DELETE' },
		'Failed to delete person'
	);
	return { change: res.change };
}

export function fetchPersonPage(
	treeId: string,
	personId: string,
	fetchFn: typeof fetch = fetch
): Promise<PersonPageDto> {
	return call(
		path`/api/trees/${treeId}/people/${personId}`,
		undefined,
		'Failed to load the person',
		fetchFn
	);
}

export async function createFactApi(
	treeId: string,
	personId: string,
	fact: FactInput,
	citation: CitationInput | null = null
): Promise<{ factId: string; change: ChangeSummary | null }> {
	return call(
		path`/api/trees/${treeId}/people/${personId}/facts`,
		json('POST', citation ? { ...fact, citation } : fact),
		'Failed to add the fact'
	);
}

export async function updateFactApi(
	treeId: string,
	factId: string,
	fact: Partial<FactInput>,
	version: number,
	citation: CitationInput | null = null
): Promise<{ change: ChangeSummary | null }> {
	return call(
		path`/api/trees/${treeId}/facts/${factId}`,
		json('PUT', { ...fact, version, ...(citation ? { citation } : {}) }),
		'Failed to save the fact'
	);
}

export async function deleteFactApi(
	treeId: string,
	factId: string,
	version: number
): Promise<{ change: ChangeSummary | null }> {
	return call(
		path`/api/trees/${treeId}/facts/${factId}` + `?version=${version}`,
		{ method: 'DELETE' },
		'Failed to remove the fact'
	);
}

export async function reorderFactsApi(
	treeId: string,
	personId: string,
	orderedFactIds: string[]
): Promise<{ change: ChangeSummary | null }> {
	return call(
		path`/api/trees/${treeId}/people/${personId}/facts/reorder`,
		json('POST', { orderedFactIds }),
		'Failed to reorder the facts'
	);
}

export type FactImpactRequest =
	| { kind: 'create_fact'; personId: string; fact: FactInput }
	| { kind: 'update_fact'; factId: string; version?: number; fact: Partial<FactInput> }
	| { kind: 'delete_fact'; factId: string; version?: number };

export async function previewFactApi(
	treeId: string,
	request: FactImpactRequest
): Promise<ImpactSummary> {
	const data = await call<ImpactResponse>(
		path`/api/trees/${treeId}/facts/impact`,
		json('POST', request),
		'Failed to preview the change'
	);
	return data.impact;
}

export async function createNameApi(
	treeId: string,
	personId: string,
	name: NameInput,
	isPreferred = false,
	citation: CitationInput | null = null
): Promise<{ nameId: string; change: ChangeSummary | null }> {
	return call(
		path`/api/trees/${treeId}/people/${personId}/names`,
		json('POST', { ...name, isPreferred, ...(citation ? { citation } : {}) }),
		'Failed to add the name'
	);
}

export async function updateNameApi(
	treeId: string,
	nameId: string,
	name: Partial<NameInput>,
	version: number,
	citation: CitationInput | null = null
): Promise<{ change: ChangeSummary | null }> {
	return call(
		path`/api/trees/${treeId}/names/${nameId}`,
		json('PUT', { ...name, version, ...(citation ? { citation } : {}) }),
		'Failed to save the name'
	);
}

export async function deleteNameApi(
	treeId: string,
	nameId: string,
	version: number
): Promise<{ change: ChangeSummary | null }> {
	return call(
		path`/api/trees/${treeId}/names/${nameId}` + `?version=${version}`,
		{ method: 'DELETE' },
		'Failed to remove the name'
	);
}

export async function reorderNamesApi(
	treeId: string,
	personId: string,
	orderedNameIds: string[]
): Promise<{ change: ChangeSummary | null }> {
	return call(
		path`/api/trees/${treeId}/people/${personId}/names/reorder`,
		json('POST', { orderedNameIds }),
		'Failed to reorder the names'
	);
}

export async function setPreferredNameApi(
	treeId: string,
	personId: string,
	nameId: string,
	version?: number
): Promise<{ change: ChangeSummary | null }> {
	return call(
		path`/api/trees/${treeId}/people/${personId}/names/preferred`,
		json('POST', { nameId, version }),
		'Failed to choose the preferred name'
	);
}

/** Force a person public or private, or let their dates decide (`auto`). A manager's action. */
export async function setPersonPrivacyApi(
	treeId: string,
	personId: string,
	privacy: PersonPrivacy,
	version?: number
): Promise<{ change: ChangeSummary | null }> {
	return call(
		path`/api/trees/${treeId}/people/${personId}/privacy`,
		json('PUT', { privacy, version }),
		'Failed to change the privacy of the person'
	);
}

export async function savePrivacySettings(
	treeId: string,
	patch: Partial<PrivacySettingsDto>
): Promise<PrivacySettingsDto> {
	return call(
		path`/api/trees/${treeId}/privacy`,
		json('PUT', patch),
		'Failed to save the privacy settings'
	);
}

export interface PersonMergeBody {
	mergedId: string;
	keep?: PersonMergeChoices;
	expectedVersions?: Record<string, number>;
}

/** Both records side by side, and what the merge needs decided first. Writes nothing. */
export async function reviewPersonMergeApi(
	treeId: string,
	survivorId: string,
	body: PersonMergeBody
): Promise<{ review: PersonMergeReviewDto; impact: ImpactSummary | null }> {
	return call(
		path`/api/trees/${treeId}/people/${survivorId}/merge/impact`,
		json('POST', body),
		'Failed to review the merge'
	);
}

export async function mergePeopleApi(
	treeId: string,
	survivorId: string,
	body: PersonMergeBody
): Promise<{ change: ChangeSummary | null }> {
	return call(
		path`/api/trees/${treeId}/people/${survivorId}/merge`,
		json('POST', body),
		'Failed to merge the people'
	);
}

export type NameImpactRequest =
	| { kind: 'create_name'; personId: string; name: NameInput & { isPreferred?: boolean } }
	| { kind: 'update_name'; nameId: string; version?: number; name: Partial<NameInput> }
	| { kind: 'delete_name'; nameId: string; version?: number }
	| { kind: 'set_preferred_name'; personId: string; nameId: string; version?: number };

export async function previewNameApi(
	treeId: string,
	request: NameImpactRequest
): Promise<ImpactSummary> {
	const data = await call<ImpactResponse>(
		path`/api/trees/${treeId}/names/impact`,
		json('POST', request),
		'Failed to preview the change'
	);
	return data.impact;
}
