<script lang="ts">
	interface Props {
		/** Who to name; a private placeholder is named but not linked, since their page does not exist for this viewer. */
		person: { displayName: string; isPrivate: boolean };
		/** Where the person's page is. */
		href: string;
	}

	let { person, href }: Props = $props();
</script>

{#if person.isPrivate}
	<span class="private" title="This person is private">{person.displayName}</span>
{:else}
	<a class="link" {href}>{person.displayName}</a>
{/if}

<style>
	.link {
		cursor: pointer;
		font-weight: 500;
		color: var(--color-emerald-800);
	}
	.link:hover {
		text-decoration: underline;
	}
	.private {
		font-style: italic;
		color: #78716c;
	}
</style>
