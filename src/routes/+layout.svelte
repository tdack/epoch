<script lang="ts">
	import '../app.css';

	let { children } = $props();
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

{@render children()}
