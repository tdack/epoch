<script lang="ts">
  import { onMount } from 'svelte';
  import * as d3 from 'd3';
  import PersonNode from './PersonNode.svelte';
  import type { TreeLayoutResult } from './tree-layout';
  import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-svelte';

  interface Props {
    treeData: TreeLayoutResult;
    onSelectPerson?: (id: string) => void;
  }

  let { treeData, onSelectPerson }: Props = $props();

  let svgElement: SVGSVGElement | null = $state(null);
  let transform = $state({ k: 1, x: 400, y: 100 });
  let zoomBehavior: d3.ZoomBehavior<SVGSVGElement, unknown> | null = null;

  onMount(() => {
    if (!svgElement) return;

    zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 3])
      .on('zoom', (event) => {
        transform = event.transform;
      });

    const sel = d3.select(svgElement);
    sel.call(zoomBehavior);

    // Initial center transform
    const initialTransform = d3.zoomIdentity.translate(svgElement.clientWidth / 2, 80).scale(0.85);
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
      const initialTransform = d3.zoomIdentity.translate(svgElement.clientWidth / 2, 80).scale(0.85);
      d3.select(svgElement).transition().duration(300).call(zoomBehavior.transform, initialTransform);
    }
  }
</script>

<div class="relative w-full h-[75vh] overflow-hidden bg-[#f7f3ea] rounded-2xl border border-stone-300/80 shadow-inner">
  <!-- Subtle decorative canvas grid pattern -->
  <div
    class="absolute inset-0 pointer-events-none opacity-40"
    style="background-image: radial-gradient(circle, #d6cebf 1px, transparent 1px); background-size: 24px 24px;"
  ></div>

  <!-- Interactive Canvas Zoom Controls -->
  <div class="absolute bottom-6 right-6 z-20 flex items-center space-x-1.5 bg-[#fdfbf7]/95 backdrop-blur-md p-1.5 rounded-xl border border-stone-300 shadow-md">
    <button
      type="button"
      onclick={zoomIn}
      title="Zoom In"
      class="p-2 text-stone-600 hover:text-stone-900 hover:bg-stone-200/60 rounded-lg transition-colors cursor-pointer"
    >
      <ZoomIn class="w-4 h-4" />
    </button>
    <button
      type="button"
      onclick={zoomOut}
      title="Zoom Out"
      class="p-2 text-stone-600 hover:text-stone-900 hover:bg-stone-200/60 rounded-lg transition-colors cursor-pointer"
    >
      <ZoomOut class="w-4 h-4" />
    </button>
    <button
      type="button"
      onclick={resetZoom}
      title="Reset View"
      class="p-2 text-stone-600 hover:text-stone-900 hover:bg-stone-200/60 rounded-lg transition-colors cursor-pointer"
    >
      <Maximize2 class="w-4 h-4" />
    </button>
  </div>

  {#if treeData.nodes.length === 0}
    <div class="w-full h-full flex flex-col items-center justify-center text-stone-500 relative z-10">
      <p class="text-base font-medium text-stone-700">No family members found in this tree.</p>
      <p class="text-xs text-stone-500 mt-1">Import a GEDCOM file or add family records to begin exploring.</p>
    </div>
  {:else}
    <svg bind:this={svgElement} class="w-full h-full cursor-grab active:cursor-grabbing select-none relative z-10">
      <g transform="translate({transform.x},{transform.y}) scale({transform.k})">
        <!-- Relationship Edges / Connecting Lines -->
        {#each treeData.links as link}
          {#if link.type === 'marriage'}
            <!-- Horizontal marriage bridge connecting spouses -->
            <line
              x1={link.source.x + 105}
              y1={link.source.y}
              x2={link.target.x - 105}
              y2={link.target.y}
              class="stroke-amber-600/80 stroke-[2.5px] stroke-dashed transition-all"
              stroke-dasharray="6 3"
            />
          {:else}
            <!-- Child link descending from parental union point -->
            <path
              d="M {link.source.x} {link.source.y + 12} C {link.source.x} {(link.source.y + link.target.y) / 2}, {link.target.x} {(link.source.y + link.target.y) / 2}, {link.target.x} {link.target.y - 37}"
              class="stroke-stone-400 fill-none stroke-[2px] transition-all hover:stroke-emerald-700 hover:stroke-[3px]"
            />
          {/if}
        {/each}

        <!-- Union / Marriage Nodes (Rings & Marriage Details) -->
        {#each treeData.unionNodes || [] as union}
          <g transform="translate({union.x}, {union.y})" class="cursor-pointer group">
            <!-- Background circle for clean connector look -->
            <circle
              r="14"
              class="fill-[#fdfbf7] stroke-amber-500/80 stroke-[2px] shadow-sm transition-all group-hover:scale-110 group-hover:stroke-amber-600 group-hover:fill-amber-50"
            />
            <!-- Intertwined rings icon (SVG representation) -->
            <circle cx="-3" cy="0" r="4.5" class="fill-none stroke-amber-600 stroke-[1.5px]" />
            <circle cx="3" cy="0" r="4.5" class="fill-none stroke-amber-600 stroke-[1.5px]" />

            {#if union.marriageDate || union.marriagePlace}
              <title>Married: {[union.marriageDate, union.marriagePlace].filter(Boolean).join(' in ')}</title>
            {/if}
          </g>
        {/each}

        <!-- Individual Person Nodes -->
        {#each treeData.nodes as node}
          <foreignObject x={node.x - 105} y={node.y - 35} width="210" height="74" class="overflow-visible">
            <PersonNode
              person={node.data}
              onSelect={(id) => onSelectPerson?.(id)}
            />
          </foreignObject>
        {/each}
      </g>
    </svg>
  {/if}
</div>
