<script lang="ts">
	import type { Snippet } from 'svelte';
	import '../app.css';
	import PullToRefresh from '#lib/components/layout/PullToRefresh.svelte';
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { TIME_ZONE_COOKIE } from '#lib/shared/display-zone.js';
	import type { LayoutData } from './$types';

	interface Props {
		/** The palette and motion setting every page is painted with, from the root server load. */
		data: LayoutData;
		children: Snippet;
	}

	let { data, children }: Props = $props();

	// Server-rendered dates need the reader's zone before the browser runs; this lets the next load
	// know it. It holds no personal data, and is rewritten when the reader travels.
	onMount(() => {
		const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
		if (!zone || document.cookie.includes(`${TIME_ZONE_COOKIE}=${encodeURIComponent(zone)}`))
			return;
		document.cookie = `${TIME_ZONE_COOKIE}=${encodeURIComponent(zone)}; path=/; max-age=31536000; samesite=lax`;
		// A first visit was rendered in UTC. Pages that format in the reader's zone return `timeZone`;
		// reload them once. The cookie now matches, so the next load agrees and this cannot loop.
		const rendered = (page.data as { timeZone?: string }).timeZone;
		if (rendered && rendered !== zone) void invalidateAll();
	});

	// Pages are rendered on the server, so a button can be seen before it works. This marks the
	// moment the page is interactive, for tests and for anything that must not click early; the root
	// layout mounts after every page and layout below it.
	onMount(() => {
		document.body.dataset.hydrated = '';
		return () => delete document.body.dataset.hydrated;
	});
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

<!-- Rendered on the server, so the first paint already honours "Reduce animation" (ADR-054):
     styles and scripts key off the attribute. `display: contents` keeps it out of the layout. -->
<div style="display: contents" data-reduce-motion={data.isMotionReduced ? '' : undefined}>
	{@render children()}
	<PullToRefresh />
</div>
