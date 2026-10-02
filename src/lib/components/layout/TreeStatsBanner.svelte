<script lang="ts">
	import { Database, GitBranch, RefreshCw } from 'lucide-svelte';
	interface Props {
		/** Name and counts from the tree summary; the banner never sees the tree's records. */
		treeName: string;
		people: number;
		unions: number;
	}

	let { treeName, people, unions }: Props = $props();
</script>

<div class="grid grid-cols-3 gap-4">
	<div
		class="flex items-center space-x-3.5 rounded-xl border border-stone-200 bg-stone-50/90 p-4 shadow-xs"
	>
		<div
			class="flex h-10 w-10 items-center justify-center rounded-lg border border-emerald-300/60 bg-emerald-100/70 text-emerald-800"
		>
			<Database class="h-5 w-5" />
		</div>
		<div>
			<p class="text-[11px] font-semibold tracking-wider text-stone-500 uppercase">
				Individuals in D1
			</p>
			<p class="text-xl font-bold text-stone-900">{people}</p>
		</div>
	</div>
	<div
		class="flex items-center space-x-3.5 rounded-xl border border-stone-200 bg-stone-50/90 p-4 shadow-xs"
	>
		<div
			class="flex h-10 w-10 items-center justify-center rounded-lg border border-orange-300/60 bg-orange-100/80 text-orange-800"
		>
			<GitBranch class="h-5 w-5" />
		</div>
		<div>
			<p class="text-[11px] font-semibold tracking-wider text-stone-500 uppercase">Unions</p>
			<p class="text-xl font-bold text-stone-900">{unions}</p>
		</div>
	</div>
	<div
		class="flex items-center space-x-3.5 rounded-xl border border-stone-200 bg-stone-50/90 p-4 shadow-xs"
	>
		<div
			class="flex h-10 w-10 items-center justify-center rounded-lg border border-amber-300/60 bg-amber-100/80 text-amber-900"
		>
			<RefreshCw class="h-5 w-5" />
		</div>
		<div class="min-w-0">
			<p class="text-[11px] font-semibold tracking-wider text-stone-500 uppercase">Active Tree</p>
			<p class="truncate text-base font-bold text-stone-900">{treeName}</p>
		</div>
	</div>
</div>
