<script lang="ts">
	import { requestPrint } from './print.js';

	let isUnavailable = $state(false);
</script>

<button
	type="button"
	class="action-btn"
	onclick={() => {
		isUnavailable = false;
		requestPrint(() => (isUnavailable = true));
	}}>Print</button
>
<p role="status" class="basis-full text-sm text-stone-700 empty:hidden print:hidden">
	{#if isUnavailable}
		This app window can't print.
		<!-- A new window leaves the installed app for the browser, whose share menu can print. -->
		<a class="text-link" href={location.href} target="_blank" rel="noopener"
			>Open this page in the browser</a
		>
		and print from there.
	{/if}
</p>
