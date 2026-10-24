import type { ImpactResponse } from '#lib/shared/api-contracts.js';
import type { ChangeSummary, ImpactSummary } from '#lib/types/genealogy.js';
import type {
	CitationInput,
	CitationSubjectRef,
	RepositoryInput,
	RepositoryListItem,
	SourceDto,
	SourceInput,
	SourceListItem
} from '#lib/shared/evidence.js';
import type { Page } from '#lib/shared/lists.js';
import { type Changed, call, json, path } from './client.js';

export async function fetchSources(
	treeId: string,
	params: URLSearchParams,
	fetcher: typeof fetch = fetch
): Promise<Page<SourceListItem>> {
	return call(
		path`/api/trees/${treeId}/lists/sources` + `?${params}`,
		{ method: 'GET' },
		'Failed to list the sources',
		fetcher
	);
}

export async function fetchRepositories(
	treeId: string,
	params: URLSearchParams,
	fetcher: typeof fetch = fetch
): Promise<Page<RepositoryListItem>> {
	return call(
		path`/api/trees/${treeId}/lists/repositories` + `?${params}`,
		{ method: 'GET' },
		'Failed to list the repositories',
		fetcher
	);
}

export async function fetchSource(
	treeId: string,
	sourceId: string,
	params: URLSearchParams,
	fetcher: typeof fetch = fetch
): Promise<SourceDto> {
	return call(
		path`/api/trees/${treeId}/sources/${sourceId}` + `?${params}`,
		{ method: 'GET' },
		'Failed to load the source',
		fetcher
	);
}

export async function createSourceApi(
	treeId: string,
	source: SourceInput
): Promise<{ sourceId: string; change: ChangeSummary | null }> {
	return call(path`/api/trees/${treeId}/sources`, json('POST', source), 'Failed to add the source');
}

export async function updateSourceApi(
	treeId: string,
	sourceId: string,
	source: SourceInput,
	version: number
): Promise<Changed> {
	return call(
		path`/api/trees/${treeId}/sources/${sourceId}`,
		json('PUT', { ...source, version }),
		'Failed to save the source'
	);
}

export async function deleteSourceApi(
	treeId: string,
	sourceId: string,
	options: { version: number; shouldRemoveCitations?: boolean }
): Promise<Changed> {
	const query = new URLSearchParams({ version: String(options.version) });
	if (options.shouldRemoveCitations) query.set('removeCitations', 'true');
	return call(
		path`/api/trees/${treeId}/sources/${sourceId}` + `?${query}`,
		{ method: 'DELETE' },
		'Failed to delete the source'
	);
}

export async function mergeSourcesApi(
	treeId: string,
	survivorId: string,
	body: { mergedIds: string[]; expectedVersions?: Record<string, number> }
): Promise<Changed> {
	return call(
		path`/api/trees/${treeId}/sources/${survivorId}/merge`,
		json('POST', body),
		'Failed to merge the sources'
	);
}

export type EvidenceImpactRequest =
	| { kind: 'delete_source'; sourceId: string; version?: number; shouldRemoveCitations?: boolean }
	| { kind: 'merge_sources'; survivorId: string; mergedIds: string[] }
	| { kind: 'remove_citation'; citationId: string; version?: number }
	| { kind: 'delete_repository'; repositoryId: string; version?: number };

export async function previewEvidenceApi(
	treeId: string,
	request: EvidenceImpactRequest
): Promise<ImpactSummary> {
	const data = await call<ImpactResponse>(
		path`/api/trees/${treeId}/sources/impact`,
		json('POST', request),
		'Failed to preview the change'
	);
	return data.impact;
}

export async function createRepositoryApi(
	treeId: string,
	repository: RepositoryInput
): Promise<{ repositoryId: string; change: ChangeSummary | null }> {
	return call(
		path`/api/trees/${treeId}/repositories`,
		json('POST', repository),
		'Failed to add the repository'
	);
}

export async function updateRepositoryApi(
	treeId: string,
	repositoryId: string,
	repository: RepositoryInput,
	version: number
): Promise<Changed> {
	return call(
		path`/api/trees/${treeId}/repositories/${repositoryId}`,
		json('PUT', { ...repository, version }),
		'Failed to save the repository'
	);
}

export async function deleteRepositoryApi(
	treeId: string,
	repositoryId: string,
	version: number
): Promise<Changed> {
	return call(
		path`/api/trees/${treeId}/repositories/${repositoryId}` + `?version=${version}`,
		{ method: 'DELETE' },
		'Failed to delete the repository'
	);
}

export async function linkRepositoryApi(
	treeId: string,
	sourceId: string,
	body: { repositoryId: string; callNumber: string | null }
): Promise<{ linkId: string; change: ChangeSummary | null }> {
	return call(
		path`/api/trees/${treeId}/sources/${sourceId}/repositories`,
		json('POST', body),
		'Failed to link the repository'
	);
}

export async function updateSourceLinkApi(
	treeId: string,
	linkId: string,
	callNumber: string | null,
	version: number
): Promise<Changed> {
	return call(
		path`/api/trees/${treeId}/source-links/${linkId}`,
		json('PUT', { callNumber, version }),
		'Failed to save the call number'
	);
}

export async function unlinkRepositoryApi(
	treeId: string,
	linkId: string,
	version: number
): Promise<Changed> {
	return call(
		path`/api/trees/${treeId}/source-links/${linkId}` + `?version=${version}`,
		{ method: 'DELETE' },
		'Failed to unlink the repository'
	);
}

/**
 * One source cited for each person, or each person's facts of `factType`; people already cited
 * for it come back as skipped, and those with no such fact as missing.
 */
export async function citePeopleApi(
	treeId: string,
	personIds: string[],
	citation: CitationInput,
	factType?: string
): Promise<{
	skippedPersonIds: string[];
	missingFactPersonIds: string[];
	change: ChangeSummary | null;
}> {
	return call(
		path`/api/trees/${treeId}/citations/people`,
		json('POST', { ...citation, personIds, factType }),
		'Failed to add the citations'
	);
}

export async function addCitationApi(
	treeId: string,
	subject: CitationSubjectRef,
	citation: CitationInput
): Promise<{ citationId: string; change: ChangeSummary | null }> {
	return call(
		path`/api/trees/${treeId}/citations`,
		json('POST', { subject, ...citation }),
		'Failed to add the citation'
	);
}

export async function updateCitationApi(
	treeId: string,
	citationId: string,
	citation: CitationInput,
	version: number
): Promise<Changed> {
	return call(
		path`/api/trees/${treeId}/citations/${citationId}`,
		json('PUT', { ...citation, version }),
		'Failed to save the citation'
	);
}

export async function removeCitationApi(
	treeId: string,
	citationId: string,
	version: number
): Promise<Changed> {
	return call(
		path`/api/trees/${treeId}/citations/${citationId}` + `?version=${version}`,
		{ method: 'DELETE' },
		'Failed to remove the citation'
	);
}

export async function reorderCitationsApi(
	treeId: string,
	subject: CitationSubjectRef,
	orderedCitationIds: string[]
): Promise<Changed> {
	return call(
		path`/api/trees/${treeId}/citations/reorder`,
		json('POST', { subject, orderedCitationIds }),
		'Failed to reorder the citations'
	);
}
