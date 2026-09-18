<script lang="ts">
  import { onMount } from 'svelte';
  import * as d3 from 'd3';
  import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-svelte';
  import type { NeutralGraphLayout } from './neutral-graph-layout';

  interface Props {
    layout: NeutralGraphLayout;
    onSelectPerson?: (id: string) => void;
  }

  let { layout, onSelectPerson }: Props = $props();

  let svgElement: SVGSVGElement | null = $state(null);
  let transform = $state({ k: 1, x: 400, y: 100 });
  let zoomBehavior: d3.ZoomBehavior<SVGSVGElement, unknown> | null = null;

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
</script>

<div class="relative w-full h-[75vh] overflow-hidden bg-[#f7f3ea] rounded-2xl border border-stone-300/80 shadow-inner">
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
    <svg bind:this={svgElement} class="w-full h-full cursor-grab active:cursor-grabbing select-none relative z-10">
      <g transform="translate({transform.x},{transform.y}) scale({transform.k})">
        <!-- Links -->
        {#each layout.links as link}
          {#if link.type === 'partner'}
            <line
              x1={link.source.x}
              y1={link.source.y}
              x2={link.target.x}
              y2={link.target.y}
              class="stroke-amber-600/70 stroke-[2px] stroke-dashed"
              stroke-dasharray="5 4"
            />
          {:else}
            <path
              d="M {link.source.x} {link.source.y} C {link.source.x} {(link.source.y + link.target.y) / 2}, {link.target.x} {(link.source.y + link.target.y) / 2}, {link.target.x} {link.target.y}"
              stroke={typeColor(link.relationshipType)}
              stroke-width="2"
              class="fill-none opacity-70"
            />
          {/if}
        {/each}

        <!-- Union nodes -->
        {#each layout.unions as union}
          <g transform="translate({union.x}, {union.y})" class="cursor-pointer">
            <circle r="13" class="fill-[#fdfbf7] stroke-amber-500/80 stroke-[2px]" />
            <circle cx="-3" cy="0" r="4.5" class="fill-none stroke-amber-600 stroke-[1.5px]" />
            <circle cx="3" cy="0" r="4.5" class="fill-none stroke-amber-600 stroke-[1.5px]" />
            <title>Union {union.union.status}</title>
          </g>
        {/each}

        <!-- People -->
        {#each layout.people as node}
          <g
            transform="translate({node.x - NODE_WIDTH / 2}, {node.y - NODE_HEIGHT / 2})"
            class="cursor-pointer group"
            role="button"
            tabindex="0"
            onclick={() => onSelectPerson?.(node.person.id)}
            onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelectPerson?.(node.person.id); }}
          >
            <rect
              width={NODE_WIDTH}
              height={NODE_HEIGHT}
              rx="12"
              class="fill-[#fdfbf7] stroke-stone-300 hover:stroke-emerald-600 transition-colors"
              class:stroke-2={node.person.id === layout.focusPersonId}
            />
            <text
              x="14"
              y="30"
              class="fill-stone-900 text-sm font-bold"
            >{node.person.displayName}</text>
            {#if node.person.isDeceased}
              <text x="14" y="52" class="fill-stone-500 text-xs">deceased</text>
            {/if}
            {#if node.person.id === layout.focusPersonId}
              <circle cx={NODE_WIDTH - 16} cy="16" r="5" class="fill-emerald-600" />
            {/if}
          </g>
        {/each}
      </g>
    </svg>
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
