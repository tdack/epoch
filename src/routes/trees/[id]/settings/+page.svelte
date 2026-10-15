<script lang="ts">
	import { invalidate } from '$app/navigation';
	import PaletteEditor from '#lib/components/settings/PaletteEditor.svelte';
	import { saveMySettings, saveSiteSettings } from '#lib/api/tree-api.js';
	import { SETTINGS_DEPENDENCY, type SettingsPatch } from '#lib/shared/settings.js';
	import { treePath } from '#lib/shared/tree-slug.js';
	import type { PageData } from './$types';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();

	const settings = $derived(data.settings);
	const isInstallOwner = $derived(data.summary.viewer.isInstallOwner);
	const base = $derived(treePath(data.summary.tree));

	// The root layout reads the palette every page paints with; reloading it repaints them all.
	async function saveMine(patch: SettingsPatch) {
		await saveMySettings(patch);
		await invalidate(SETTINGS_DEPENDENCY);
	}
	// Follows the stored choice; flipped at once on change so the box answers before the save does.
	let isMotionReduced = $derived(settings.user.isMotionReduced ?? false);
	let isSavingMotion = $state(false);
	let motionError = $state<string | null>(null);
	async function saveMotion(isChecked: boolean) {
		isMotionReduced = isChecked;
		isSavingMotion = true;
		motionError = null;
		try {
			// Off clears the choice rather than storing false: there is no site default to override.
			await saveMine({ isMotionReduced: isChecked ? true : null });
		} catch (error) {
			isMotionReduced = !isChecked;
			motionError = error instanceof Error ? error.message : 'Could not save the setting.';
		} finally {
			isSavingMotion = false;
		}
	}
	async function saveSite(patch: SettingsPatch) {
		await saveSiteSettings(patch);
		await invalidate(SETTINGS_DEPENDENCY);
	}
</script>

<svelte:head>
	<title>Settings · Epoch</title>
</svelte:head>

<div class="mx-auto flex w-full max-w-4xl flex-col gap-8">
	<header>
		<h2 class="text-2xl font-bold text-stone-900">Settings</h2>
		<p class="mt-1 text-sm text-stone-600">
			These are yours, in every tree. Anything you leave alone follows the site default.
		</p>
	</header>

	<section aria-labelledby="my-colours-heading" class="flex flex-col gap-3">
		<h3 id="my-colours-heading" class="text-lg font-bold text-stone-900">My colours</h3>
		<PaletteEditor
			idPrefix="mine"
			stored={settings.user}
			below={[settings.site]}
			inheritedName="the site default"
			onsave={saveMine}
		/>
	</section>

	<section aria-labelledby="motion-heading" class="flex flex-col gap-2">
		<h3 id="motion-heading" class="text-lg font-bold text-stone-900">Motion</h3>
		<label class="flex items-start gap-2 text-sm text-stone-800">
			<input
				type="checkbox"
				class="mt-0.5 h-4 w-4"
				checked={isMotionReduced}
				disabled={isSavingMotion}
				onchange={(event) => void saveMotion(event.currentTarget.checked)}
				aria-describedby="motion-hint motion-error"
			/>
			<span>
				<span class="font-semibold">Reduce animation</span>
				<span id="motion-hint" class="block text-xs text-stone-600">
					Holds the tree still: no gliding between people, no spinning or drifting in the 3D views.
					If your device already asks for less motion, that applies whatever you choose here.
				</span>
			</span>
		</label>
		<p id="motion-error" role="alert" class="text-sm font-medium text-red-800">
			{motionError ?? ''}
		</p>
	</section>

	{#if isInstallOwner}
		<section aria-labelledby="site-colours-heading" class="flex flex-col gap-3">
			<h3 id="site-colours-heading" class="text-lg font-bold text-stone-900">Site default</h3>
			<p class="text-sm text-stone-600">
				What everyone sees who has not chosen their own colours, including readers of the public
				tree. You set it as the install owner.
			</p>
			<PaletteEditor
				idPrefix="site"
				stored={settings.site}
				below={[]}
				inheritedName="the built-in colours"
				onsave={saveSite}
			/>
		</section>
	{/if}

	<section aria-labelledby="also-yours-heading" class="flex flex-col gap-2">
		<h3 id="also-yours-heading" class="text-lg font-bold text-stone-900">Also yours</h3>
		<ul class="list-disc pl-5 text-sm text-stone-700">
			<li>
				Your default tree, the one Epoch opens first, is chosen on the
				<a href="{base}/trees" class="font-semibold text-emerald-900 underline">Trees page</a>.
			</li>
			<li>
				Your default view of a tree (Flat, Rings, Ball, Ribbons or Orrery) is chosen from the tree's
				toolbar.
			</li>
		</ul>
	</section>
</div>
