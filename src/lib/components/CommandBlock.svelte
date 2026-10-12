<script lang="ts">
	interface Props {
		/** Shell lines, one command each, shown and copied exactly as given. */
		lines: string[];
		/** `dark` sits on the emerald sections; `light` on cream. */
		tone?: 'dark' | 'light';
		/** Names the block for the copy button, e.g. "the local setup commands". */
		label: string;
	}

	let { lines, tone = 'light', label }: Props = $props();

	let status = $state<'idle' | 'copied' | 'failed'>('idle');
	let resetTimer: ReturnType<typeof setTimeout> | undefined;

	async function copy() {
		try {
			await navigator.clipboard.writeText(lines.join('\n'));
			status = 'copied';
		} catch {
			// Clipboard access is refused in some embedded and insecure contexts; the text is still
			// there to select by hand.
			status = 'failed';
		}
		clearTimeout(resetTimer);
		resetTimer = setTimeout(() => (status = 'idle'), 2400);
	}
</script>

<div class="block {tone}">
	<pre><code>{lines.join('\n')}</code></pre>
	<button type="button" onclick={copy} aria-label="Copy {label}">
		{#if status === 'copied'}
			<svg
				width="16"
				height="16"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2.2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg
			>
			Copied
		{:else if status === 'failed'}
			Select to copy
		{:else}
			<svg
				width="16"
				height="16"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
				><rect x="9" y="9" width="13" height="13" rx="2" /><path
					d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
				/></svg
			>
			Copy
		{/if}
	</button>
	<span class="visually-hidden" role="status">{status === 'copied' ? 'Copied' : ''}</span>
</div>

<style>
	.block {
		position: relative;
		border-radius: 12px;
	}

	pre {
		margin: 0;
		padding: 18px 108px 18px 20px;
		border-radius: inherit;
		overflow-x: auto;
		font-size: 0.9375rem;
		line-height: 1.8;
	}

	.dark pre {
		background: var(--emerald-ink);
		border: 1px solid rgb(110 231 183 / 0.22);
		color: #ecfdf5;
		scrollbar-color: rgb(110 231 183 / 0.35) transparent;
	}

	.light pre {
		background: var(--field-white);
		border: 1px solid var(--stone-edge);
		color: var(--stone-ink);
		scrollbar-color: var(--stone-edge) transparent;
	}

	button {
		position: absolute;
		top: 8px;
		right: 8px;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-height: 36px;
		padding: 0 12px;
		border-radius: 8px;
		font: inherit;
		font-size: 0.8125rem;
		font-weight: 600;
		cursor: pointer;
	}

	@media (pointer: coarse) {
		button {
			min-height: 44px;
		}
	}

	/* On a phone the first line is wider than the box, so the button would sit over it; it moves
	above the code instead. */
	@media (max-width: 560px) {
		.block {
			display: flex;
			flex-direction: column;
			align-items: flex-end;
			gap: 8px;
		}

		.block > button {
			position: static;
			order: -1;
		}

		pre {
			align-self: stretch;
			padding-right: 20px;
		}
	}

	.dark button {
		background: rgb(110 231 183 / 0.1);
		border: 1px solid rgb(110 231 183 / 0.3);
		color: var(--emerald-100);
	}

	.dark button:hover {
		background: rgb(110 231 183 / 0.18);
	}

	.dark button:focus-visible {
		outline-color: var(--amber-300);
	}

	.light button {
		background: var(--stone-shelf);
		border: 1px solid var(--stone-edge);
		color: var(--stone-body);
	}

	.light button:hover {
		background: var(--stone-rule);
	}
</style>
