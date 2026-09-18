import type {
	TreeSummary,
	TreeDetails,
	PersonFormData,
	RelationshipIntent,
	RelationshipPlan,
	RelationshipGraph,
	PeopleSearchResult
} from '#lib/types/genealogy.js';

export async function fetchTrees(): Promise<TreeSummary[]> {
  const res = await fetch('/api/trees');
  if (!res.ok) {
    throw new Error('Failed to load trees');
  }
  const data = (await res.json()) as { trees?: TreeSummary[] };
  return data.trees || [];
}

export async function fetchTreeDetails(treeId: string): Promise<TreeDetails> {
  const res = await fetch(`/api/trees/${treeId}`);
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || 'Failed to fetch tree details');
  }
  return (await res.json()) as TreeDetails;
}

export async function createTreeApi(payload: { name: string; description?: string }): Promise<{ id: string; name: string }> {
  const res = await fetch('/api/trees', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = (await res.json().catch(() => ({}))) as {
    tree?: { id: string; name: string };
    error?: string;
  };

  if (!res.ok) {
    throw new Error(data.error || 'Failed to create tree');
  }

  return data.tree!;
}

export async function deleteTreeApi(treeId: string): Promise<void> {
  const res = await fetch(`/api/trees/${treeId}`, { method: 'DELETE' });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || 'Failed to delete tree');
  }
}

export async function createIndividualApi(treeId: string, data: PersonFormData): Promise<{ id: string }> {
  const res = await fetch(`/api/trees/${treeId}/individuals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });

  const resData = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    individual?: { id: string };
    error?: string;
  };

  if (!res.ok) {
    throw new Error(resData.error || 'Failed to add individual.');
  }

  return resData.individual!;
}

export async function updateIndividualApi(treeId: string, individualId: string, data: PersonFormData): Promise<void> {
  const res = await fetch(`/api/trees/${treeId}/individuals/${individualId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });

  const resData = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    error?: string;
  };

  if (!res.ok) {
    throw new Error(resData.error || 'Failed to update person.');
  }
}

export async function previewGedcomImport(file: File, treeId?: string | null): Promise<import('#lib/types/genealogy.js').ImportPreviewData> {
  if (treeId) {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('treeId', treeId);
    const res = await fetch('/api/import', { method: 'PUT', body: fd });
    const data = (await res.json().catch(() => ({}))) as import('#lib/types/genealogy.js').ImportPreviewData & { error?: string };
    if (!res.ok) throw new Error(data.error || 'Failed to preview import');
    return data;
  }

  return {
    mode: 'replace',
    incoming: { individuals: 0, families: 0, events: 0 }
  };
}

export async function submitGedcomImport(
  file: File,
  mode: 'replace' | 'merge',
  treeId?: string | null
): Promise<{ individualsCount?: number; familiesCount?: number; treeId?: string }> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('mode', mode);
  if (treeId) {
    fd.append('treeId', treeId);
  }

  const res = await fetch('/api/import', {
    method: 'POST',
    body: fd
  });

  const resData = (await res.json().catch(() => ({}))) as {
    error?: string;
    individualsCount?: number;
    familiesCount?: number;
    treeId?: string;
  };

  if (!res.ok) throw new Error(resData.error || 'Import failed');
  return resData;
}

export async function applyRelationshipApi(
  treeId: string,
  intent: RelationshipIntent
): Promise<RelationshipPlan> {
  const res = await fetch(`/api/trees/${treeId}/relationships`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ intent })
  });

  const data = (await res.json().catch(() => ({}))) as {
    plan?: RelationshipPlan;
    error?: string;
  };

  if (!res.ok) throw new Error(data.error || 'Failed to apply relationship');
  return data.plan!;
}

export async function fetchRelationshipGraph(treeId: string): Promise<RelationshipGraph> {
  const res = await fetch(`/api/trees/${treeId}/graph`);
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || 'Failed to load relationship graph');
  }
  const data = (await res.json()) as { graph?: RelationshipGraph };
  return data.graph!;
}

export async function searchPeopleApi(treeId: string, query: string): Promise<PeopleSearchResult[]> {
  const res = await fetch(`/api/trees/${treeId}/people-search?q=${encodeURIComponent(query)}`);
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || 'Failed to search people');
  }
  const data = (await res.json()) as { people?: PeopleSearchResult[] };
  return data.people || [];
}
