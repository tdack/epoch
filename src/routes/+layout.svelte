<script lang="ts">
	import '../app.css';
	import type { Snippet } from 'svelte';
	import SiteNav from '#lib/components/SiteNav.svelte';

	let { children }: { children: Snippet } = $props();
</script>

<!-- The nav is sticky and overlaps the top of whatever header follows it: the home hero or a
page's compact header. -->
<SiteNav />
{@render children()}
