<script lang="ts">
	import { LINK_TARGET, type RelativeTarget } from './person/relative-target.js';

	interface Props {
		/** Who to name; a private placeholder is named but not linked, since their page does not exist for this viewer. */
		person: { id: string; displayName: string; isPrivate: boolean };
		/** Where the person's page is. */
		href: string;
		/** What a click does: follow `href`, or hand the id to the canvas. */
		relativeTarget?: RelativeTarget;
	}

	let { person, href, relativeTarget = LINK_TARGET }: Props = $props();
</script>

{#if person.isPrivate}
	<span class="private" title="This person is private">{person.displayName}</span>
{:else if relativeTarget.kind === 'select'}
	<button type="button" class="link" onclick={() => relativeTarget.onSelect(person.id)}
		>{person.displayName}</button
	>
{:else}
	<a class="link" {href}>{person.displayName}</a>
{/if}

<style>
	.link {
		cursor: pointer;
		font-weight: 500;
		color: var(--color-emerald-800);
		text-align: left;
	}
	.link:hover {
		text-decoration: underline;
	}
	.private {
		font-style: italic;
		color: #78716c;
	}
</style>
