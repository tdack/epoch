<script lang="ts">
	import type { Snippet } from 'svelte';
	import '../app.css';
	import type { LayoutData } from './$types';

	interface Props {
		/** The palette and motion setting every page is painted with, from the root server load. */
		data: LayoutData;
		children: Snippet;
	}

	let { data, children }: Props = $props();
</script>

<svelte:head>
	<title>Epoch</title>
	<!-- `sizes` on the ICO keeps Chromium from preferring it over the SVG; it is for older clients. -->
	<link rel="icon" href="/favicon.ico" sizes="32x32" />
	<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
	<link rel="apple-touch-icon" href="/brand/apple-touch-icon.png" />
	<link rel="manifest" href="/brand/manifest.webmanifest" />
	<meta name="theme-color" content="#065f46" />
</svelte:head>

<!-- Rendered on the server, so the first paint already honours "Reduce animation" (ADR-053):
     styles and scripts key off the attribute. `display: contents` keeps it out of the layout. -->
<div style="display: contents" data-reduce-motion={data.isMotionReduced ? '' : undefined}>
	{@render children()}
</div>
