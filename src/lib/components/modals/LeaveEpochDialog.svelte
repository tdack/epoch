<script lang="ts">
	import { LogOut } from '@lucide/svelte';
	import BaseModal from './BaseModal.svelte';

	interface Props {
		isOpen: boolean;
		onclose: () => void;
	}

	let { isOpen, onclose }: Props = $props();
</script>

<!-- Explains only: there is deliberately no confirm action until leaving is built (ADR-070). -->
<BaseModal {isOpen} title="Leave Epoch" icon={LogOut} {onclose}>
	<div class="space-y-3 text-sm text-stone-700">
		<p>This is not available yet. When it is, leaving Epoch will:</p>
		<ul class="list-disc space-y-1 pl-5">
			<li>Remove you from every tree, and delete your settings, favourites and profile picture.</li>
			<li>
				Keep your account record, so the history of edits you made still shows who made them. The
				trees and everything in them stay as they are.
			</li>
			<li>
				Turn you away at sign-in. Someone can invite you back later, which gives you a fresh start.
			</li>
		</ul>
		<p>
			Anyone who is the only owner of a tree, and the owner of this Epoch, will first need to hand
			ownership to someone else.
		</p>
	</div>
	<div class="flex justify-end">
		<button type="button" onclick={onclose} class="btn-primary">Close</button>
	</div>
</BaseModal>
