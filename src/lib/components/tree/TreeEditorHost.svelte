<script lang="ts">
  import ConflictDialog from '#lib/components/modals/ConflictDialog.svelte';
  import ImpactDialog from '#lib/components/modals/ImpactDialog.svelte';
  import PersonModal from '#lib/components/modals/PersonModal.svelte';
  import RelationshipModal from '#lib/components/modals/RelationshipModal.svelte';
  import UnionEditorModal from '#lib/components/modals/UnionEditorModal.svelte';
  import UnionMergeDialog from '#lib/components/modals/UnionMergeDialog.svelte';
  import { previewUnionMergeApi } from '#lib/services/tree-api.js';
  import type { TreeEditor } from './tree-editor.svelte.js';

  interface Props {
    /** The editor whose dialogs this renders; screens open them through it. */
    editor: TreeEditor;
  }

  let { editor }: Props = $props();
  const graph = $derived(editor.graph);
</script>

<PersonModal
  show={editor.showPersonModal}
  mode={editor.personModalMode}
  initialPerson={editor.personToEdit}
  isSubmitting={editor.isSubmittingPerson}
  error={editor.personModalError}
  onclose={() => (editor.showPersonModal = false)}
  onsubmit={editor.savePerson}
/>

{#if editor.relationshipAnchor && graph}
  <RelationshipModal
    show={editor.showRelationshipModal}
    treeId={editor.treeId}
    anchor={editor.relationshipAnchor}
    {graph}
    preselect={editor.relationshipPreselect}
    initialKind={editor.relationshipKind}
    initialUnionId={editor.relationshipUnionId}
    onclose={() => (editor.showRelationshipModal = false)}
    onsaved={editor.relationshipSaved}
    onrefresh={editor.refresh}
  />
{/if}

<UnionEditorModal
  show={editor.editingUnion !== null}
  treeId={editor.treeId}
  union={editor.editingUnion}
  label={editor.editingUnion ? (editor.unionLabels.get(editor.editingUnion.id) ?? null) : null}
  nameOf={editor.nameOf}
  onclose={() => (editor.editingUnionId = null)}
  onsaved={editor.unionSaved}
  onrefresh={editor.refresh}
/>

<ImpactDialog
  show={editor.pendingImpact !== null}
  title={editor.pendingImpact?.title ?? ''}
  impact={editor.pendingImpact?.impact ?? null}
  isLoading={editor.pendingImpact !== null && editor.pendingImpact.impact === null && editor.pendingImpact.error === null}
  isConfirming={editor.pendingImpact?.isConfirming ?? false}
  error={editor.pendingImpact?.error ?? null}
  confirmLabel={editor.pendingImpact?.confirmLabel ?? 'Confirm'}
  onconfirm={editor.runPendingImpact}
  oncancel={() => (editor.pendingImpact = null)}
/>

<UnionMergeDialog
  show={editor.mergingUnionId !== null && editor.mergeCandidates.length >= 2}
  partners={editor.mergePartners}
  candidates={editor.mergeCandidates}
  onpreview={(request) => previewUnionMergeApi(editor.treeId, request)}
  onconfirm={editor.runMerge}
  oncancel={() => (editor.mergingUnionId = null)}
/>

<ConflictDialog
  show={editor.personConflict !== null}
  subject={editor.personToEdit?.name ?? ''}
  rows={editor.personConflict ? editor.personFormRows(editor.personConflict.changes, editor.personConflict.error.details.current) : []}
  isWorking={editor.isSubmittingPerson}
  onreload={editor.reloadPersonEdit}
  onreapply={editor.reapplyPersonEdit}
  oncancel={() => (editor.personConflict = null)}
/>
