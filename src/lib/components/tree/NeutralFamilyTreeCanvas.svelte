<script lang="ts">
  import { onMount } from 'svelte';
  import * as d3 from 'd3';
  import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-svelte';
  import type { NeutralGraphLayout, GraphLink } from './neutral-graph-layout';

  interface PersonRef {
    id: string;
    displayName: string;
  }

  /** Drag-to-relate: user released a drag from one person onto another. */
  interface DragRelate {
    source: PersonRef;
    target: PersonRef;
  }

  interface Props {
    layout: NeutralGraphLayout;
    onSelectPerson?: (id: string) => void;
    onEditPerson?: (id: string) => void;
    onDeletePerson?: (id: string) => void;
    onAddRelationship?: (anchor: PersonRef) => void;
    onRemoveLink?: (link: GraphLink) => void;
    onRemoveUnion?: (unionId: string) => void;
    onDragRelate?: (relate: DragRelate) => void;
  }

  let {
    layout,
    onSelectPerson,
    onEditPerson,
    onDeletePerson,
    onAddRelationship,
    onRemoveLink,
    onRemoveUnion,
    onDragRelate
  }: Props = $props();

  let svgElement: SVGSVGElement | null = $state(null);
  let transform = $state({ k: 1, x: 400, y: 100 });
  let zoomBehavior: d3.ZoomBehavior<SVGSVGElement, unknown> | null = null;

  // Context menu state (menu items + screen coords inside this container).
  let menu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);
  // Selected link id (for Delete-key removal), and drag source person id.
  let selectedLinkId = $state<string | null>(null);
  let dragSourceId = $state<string | null>(null);

  interface MenuItem {
    label: string;
    danger?: boolean;
    onClick: () => void;
  }

  const NODE_WIDTH = 210;
  const NODE_HEIGHT = 74;

  onMount(() => {
    if (!svgElement) return;

    zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 3])
      .on('zoom', (event) => {
        transform = event.transform;
      });

    const sel = d3.select(svgElement);
    sel.call(zoomBehavior);

    // Centre the view on the focus person (or the layout origin).
    const initialTransform = d3.zoomIdentity.translate(svgElement.clientWidth / 2, 120).scale(0.85);
    sel.call(zoomBehavior.transform, initialTransform);
  });

  function zoomIn() {
    if (svgElement && zoomBehavior) {
      d3.select(svgElement).transition().duration(250).call(zoomBehavior.scaleBy, 1.3);
    }
  }

  function zoomOut() {
    if (svgElement && zoomBehavior) {
      d3.select(svgElement).transition().duration(250).call(zoomBehavior.scaleBy, 0.7);
    }
  }

  function resetZoom() {
    if (svgElement && zoomBehavior) {
      const initialTransform = d3.zoomIdentity.translate(svgElement.clientWidth / 2, 120).scale(0.85);
      d3.select(svgElement).transition().duration(300).call(zoomBehavior.transform, initialTransform);
    }
  }

  // Relationship type → legend colour mapping.
  const TYPE_COLORS: Record<string, string> = {
    biological: '#0f766e',
    adoptive: '#b45309',
    foster: '#7c3aed',
    guardian: '#475569',
    unknown: '#9ca3af'
  };

  function typeColor(type?: string): string {
    return type ? TYPE_COLORS[type] ?? '#9ca3af' : '#9ca3af';
  }

  // Gender colouring: border colour and a soft fill tint per sex.
  function sexStroke(sex: string | null | undefined): string {
    if (sex === 'M') return '#059669'; // emerald
    if (sex === 'F') return '#ea580c'; // orange
    return '#a8a29e'; // stone
  }

  function sexTint(sex: string | null | undefined): string {
    if (sex === 'M') return '#ecfdf5';
    if (sex === 'F') return '#fff7ed';
    return '#fdfbf7';
  }

  // ---- Context menu ----

  function openPersonMenu(e: MouseEvent, personId: string, displayName: string) {
    if (!e.target || e.button !== 2) return;
    e.preventDefault();
    const items: MenuItem[] = [];
    if (onEditPerson) {
      items.push({ label: 'Edit details', onClick: () => onEditPerson(personId) });
    }
    if (onAddRelationship) {
      items.push({ label: 'Add relationship', onClick: () => onAddRelationship({ id: personId, displayName }) });
    }
    if (onDeletePerson) {
      items.push({ label: 'Delete person', danger: true, onClick: () => onDeletePerson(personId) });
    }
    menu = { x: e.clientX, y: e.clientY, items };
  }

  function openUnionMenu(e: MouseEvent, unionId: string) {
    if (!e.target || e.button !== 2) return;
    e.preventDefault();
    const items: MenuItem[] = [];
    if (onRemoveUnion) {
      items.push({ label: 'Delete union', danger: true, onClick: () => onRemoveUnion(unionId) });
    }
    menu = { x: e.clientX, y: e.clientY, items };
  }

  function openLinkMenu(e: MouseEvent, link: GraphLink) {
    if (!e.target || e.button !== 2) return;
    e.preventDefault();
    const items: MenuItem[] = [];
    if (onRemoveLink) {
      items.push({
        label: link.type === 'parent_child' ? 'Delete relationship' : 'Delete partnership',
        danger: true,
        onClick: () => onRemoveLink(link)
      });
    }
    menu = { x: e.clientX, y: e.clientY, items };
  }

  function closeMenu() {
    menu = null;
  }

  function runMenuAction(item: MenuItem) {
    closeMenu();
    item.onClick();
  }

  // ---- Drag to relate ----

  function onNodePointerDown(e: PointerEvent, personId: string) {
    if (e.button !== 0) return;
    // Prevent d3 pan/zoom from starting on a person node.
    e.stopPropagation();
    dragSourceId = personId;
  }

  function onSvgPointerUp(e: PointerEvent) {
    if (!dragSourceId) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const targetId = el?.closest?.('[data-person-id]')?.getAttribute('data-person-id');
    if (targetId && targetId !== dragSourceId && onDragRelate) {
      const source = layout.people.find((n) => n.person.id === dragSourceId);
      const target = layout.people.find((n) => n.person.id === targetId);
      if (source && target) {
        onDragRelate({
          source: { id: source.person.id, displayName: source.person.displayName },
          target: { id: target.person.id, displayName: target.person.displayName }
        });
      }
    }
    dragSourceId = null;
  }

  function onSvgClick(e: MouseEvent) {
    // Clicking empty canvas clears link selection (and any menu).
    if ((e.target as Element)?.closest?.('[data-link-id], [data-person-id], [data-union-id]')) return;
    selectedLinkId = null;
    closeMenu();
  }

  function onLinkClick(e: MouseEvent, link: GraphLink) {
    e.stopPropagation();
    selectedLinkId = selectedLinkId === link.id ? null : link.id;
  }

  function onKeydown(e: KeyboardEvent) {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedLinkId && onRemoveLink) {
      const link = layout.links.find((l) => l.id === selectedLinkId);
      if (link) {
        e.preventDefault();
        onRemoveLink(link);
        selectedLinkId = null;
      }
    }
    if (e.key === 'Escape') {
      closeMenu();
      selectedLinkId = null;
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
<div class="relative w-full h-[75vh] overflow-hidden bg-[#f7f3ea] rounded-2xl border border-stone-300/80 shadow-inner" onclick={onSvgClick} onkeydown={onKeydown}>
  <div
    class="absolute inset-0 pointer-events-none opacity-40"
    style="background-image: radial-gradient(circle, #d6cebf 1px, transparent 1px); background-size: 24px 24px;"
  ></div>

  <div class="absolute bottom-6 right-6 z-20 flex items-center space-x-1.5 bg-[#fdfbf7]/95 backdrop-blur-md p-1.5 rounded-xl border border-stone-300 shadow-md">
    <button type="button" onclick={zoomIn} title="Zoom In" class="p-2 text-stone-600 hover:text-stone-900 hover:bg-stone-200/60 rounded-lg transition-colors cursor-pointer">
      <ZoomIn class="w-4 h-4" />
    </button>
    <button type="button" onclick={zoomOut} title="Zoom Out" class="p-2 text-stone-600 hover:text-stone-900 hover:bg-stone-200/60 rounded-lg transition-colors cursor-pointer">
      <ZoomOut class="w-4 h-4" />
    </button>
    <button type="button" onclick={resetZoom} title="Reset View" class="p-2 text-stone-600 hover:text-stone-900 hover:bg-stone-200/60 rounded-lg transition-colors cursor-pointer">
      <Maximize2 class="w-4 h-4" />
    </button>
  </div>

  {#if layout.people.length === 0}
    <div class="w-full h-full flex flex-col items-center justify-center text-stone-500 relative z-10">
      <p class="text-base font-medium text-stone-700">No people in this tree yet.</p>
    </div>
  {:else}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <svg bind:this={svgElement} class="w-full h-full cursor-grab active:cursor-grabbing select-none relative z-10" onpointerup={onSvgPointerUp}>
      <g transform="translate({transform.x},{transform.y}) scale({transform.k})">
        <!-- Links -->
        {#each layout.links as link}
          {#if link.type === 'partner'}
            <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
            <line
              data-link-id={link.id}
              x1={link.source.x}
              y1={link.source.y}
              x2={link.target.x}
              y2={link.target.y}
              onclick={(e) => onLinkClick(e, link)}
              oncontextmenu={(e) => openLinkMenu(e, link)}
              class="stroke-amber-600/70 stroke-[2px] stroke-dashed"
              class:stroke-amber-900={selectedLinkId === link.id}
              class:!stroke-[3px]={selectedLinkId === link.id}
              stroke-dasharray="5 4"
              style="cursor: pointer; pointer-events: stroke;"
            />
          {:else}
            <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
            <path
              data-link-id={link.id}
              d="M {link.source.x} {link.source.y} C {link.source.x} {(link.source.y + link.target.y) / 2}, {link.target.x} {(link.source.y + link.target.y) / 2}, {link.target.x} {link.target.y}"
              stroke={typeColor(link.relationshipType)}
              stroke-width={selectedLinkId === link.id ? 4 : 2}
              onclick={(e) => onLinkClick(e, link)}
              oncontextmenu={(e) => openLinkMenu(e, link)}
              class="fill-none opacity-70"
              style="cursor: pointer; pointer-events: stroke;"
            />
          {/if}
        {/each}

        <!-- Union nodes -->
        {#each layout.unions as union}
          {@const marrLabel = union.union.marriageDate || union.union.marriagePlace}
          <g
            data-union-id={union.id}
            transform="translate({union.x}, {union.y})"
            class="cursor-pointer"
            oncontextmenu={(e) => openUnionMenu(e, union.id)}
            role="button"
            tabindex="0"
            aria-label="Union · {union.union.status}"
          >
            <circle r="13" class="fill-[#fdfbf7] stroke-amber-500/80 stroke-[2px]" />
            <circle cx="-3" cy="0" r="4.5" class="fill-none stroke-amber-600 stroke-[1.5px]" />
            <circle cx="3" cy="0" r="4.5" class="fill-none stroke-amber-600 stroke-[1.5px]" />
            <title>Union · {union.union.status}{marrLabel ? ` · ${marrLabel}` : ''}</title>
          </g>
          {#if marrLabel}
            <text
              x={union.x}
              y={union.y - 20}
              text-anchor="middle"
              class="fill-amber-800 font-semibold pointer-events-none"
              style="font-size: 11px"
            >{marrLabel}</text>
          {/if}
        {/each}

        <!-- People -->
        {#each layout.people as node}
          <g
            data-person-id={node.person.id}
            transform="translate({node.x - NODE_WIDTH / 2}, {node.y - NODE_HEIGHT / 2})"
            class="cursor-pointer group"
            role="button"
            tabindex="0"
            onclick={() => onSelectPerson?.(node.person.id)}
            oncontextmenu={(e) => openPersonMenu(e, node.person.id, node.person.displayName)}
            onpointerdown={(e) => onNodePointerDown(e, node.person.id)}
            onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelectPerson?.(node.person.id); }}
          >
            <rect
              width={NODE_WIDTH}
              height={NODE_HEIGHT}
              rx="12"
              stroke={sexStroke(node.person.sex)}
              fill={sexTint(node.person.sex)}
              class="stroke-[1.5] hover:stroke-[2.5] transition-all"
              class:stroke-2={node.person.id === layout.focusPersonId}
            />
            <text
              x="14"
              y="30"
              class="fill-stone-900 text-sm font-bold"
            >{node.person.displayName}</text>
            {#if node.person.sex === 'M' || node.person.sex === 'F'}
              <text
                x="14"
                y="50"
                class="fill-stone-500 text-[11px]"
              >{node.person.sex === 'M' ? 'Male' : 'Female'}</text>
            {/if}
            {#if node.person.isDeceased}
              <text x="14" y="66" class="fill-stone-500 text-xs">deceased</text>
            {/if}
            {#if node.person.id === layout.focusPersonId}
              <circle cx={NODE_WIDTH - 16} cy="16" r="5" class="fill-emerald-600" />
            {/if}
          </g>
        {/each}
      </g>
    </svg>
  {/if}

  <!-- Context menu -->
  {#if menu}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      class="absolute z-30 min-w-44 bg-white border border-stone-200 rounded-lg shadow-lg py-1 text-sm"
      style="left: {menu.x}px; top: {menu.y}px;"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => {
        if (e.key === 'Escape') closeMenu();
      }}
      role="menu"
      tabindex="-1"
    >
      {#each menu.items as item}
        <button
          type="button"
          role="menuitem"
          onclick={() => runMenuAction(item)}
          class="w-full text-left px-3 py-1.5 hover:bg-stone-100 cursor-pointer {item.danger ? 'text-red-700' : 'text-stone-800'}"
        >{item.label}</button>
      {/each}
    </div>
  {/if}

  <!-- Relationship type legend -->
  <div class="absolute top-4 left-4 z-20 bg-[#fdfbf7]/95 backdrop-blur-md p-2.5 rounded-xl border border-stone-300 shadow-md space-y-1">
    <p class="text-[10px] font-bold uppercase tracking-wider text-stone-500 mb-1">Relationships</p>
    {#each [
      { t: 'biological', label: 'Biological', c: '#0f766e' },
      { t: 'adoptive', label: 'Adoptive', c: '#b45309' },
      { t: 'foster', label: 'Foster', c: '#7c3aed' },
      { t: 'guardian', label: 'Guardian', c: '#475569' },
      { t: 'unknown', label: 'Unknown', c: '#9ca3af' }
    ] as rel}
      <div class="flex items-center space-x-2 text-[11px] text-stone-700">
        <span class="w-3 h-0.5 rounded" style:background={rel.c}></span>
        <span>{rel.label}</span>
      </div>
    {/each}
    <div class="flex items-center space-x-2 text-[11px] text-stone-700">
      <span class="w-3 h-0.5 rounded bg-amber-600"></span>
      <span>Partnership</span>
    </div>
  </div>
</div>
