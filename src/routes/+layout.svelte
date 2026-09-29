<script lang="ts">
	import '../app.css';
	import favicon from '#lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<title>Epoch</title>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
