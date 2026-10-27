<script lang="ts">
	import { toCsv } from '#lib/shared/csv.js';

	interface Props {
		/** The saved file's name, with its `.csv`. */
		filename: string;
		header: string[];
		/** The cells as the page shows them, so the file reads as the page does. */
		rows: (string | number | null)[][];
	}
	let { filename, header, rows }: Props = $props();

	// Built on click, so nothing is kept alive for a download most readers never make.
	function download() {
		const url = URL.createObjectURL(new Blob([toCsv(header, rows)], { type: 'text/csv' }));
		const link = document.createElement('a');
		link.href = url;
		link.download = filename;
		link.click();
		URL.revokeObjectURL(url);
	}
</script>

<button type="button" class="action-btn print:hidden" onclick={download}>Download CSV</button>
