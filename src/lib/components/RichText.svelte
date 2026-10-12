<script lang="ts">
	interface Props {
		/** Plain text where `[text](url)` becomes a link and `` `code` `` becomes code. */
		text: string;
	}

	let { text }: Props = $props();

	type Part =
		{ kind: 'text' | 'code'; value: string } | { kind: 'link'; value: string; href: string };

	const parts = $derived.by(() => {
		const out: Part[] = [];
		const pattern = /\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`/g;
		let last = 0;
		for (const match of text.matchAll(pattern)) {
			if (match.index > last) out.push({ kind: 'text', value: text.slice(last, match.index) });
			if (match[3] !== undefined) out.push({ kind: 'code', value: match[3] });
			else out.push({ kind: 'link', value: match[1], href: match[2] });
			last = match.index + match[0].length;
		}
		if (last < text.length) out.push({ kind: 'text', value: text.slice(last) });
		return out;
	});
</script>

{#each parts as part, i (i)}{#if part.kind === 'link'}<a href={part.href}>{part.value}</a
		>{:else if part.kind === 'code'}<code>{part.value}</code>{:else}{part.value}{/if}{/each}
