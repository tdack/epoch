<script lang="ts">
	import { spokenAge } from '#lib/shared/age.js';

	interface Props {
		/** The age as `ageAt` writes it, such as "aged 10–11". */
		age: string;
		testId: string;
	}

	let { age, testId }: Props = $props();
	const HINT = 'Calculated from the birth date';
</script>

<!-- The dash and the separator are read badly aloud, so a screen reader gets its own wording. -->
<span class="text-stone-600" data-testid={testId} title={HINT}
	><span aria-hidden="true">{' · '}{age}</span><span class="sr-only"
		>, {spokenAge(age)}, {HINT.toLowerCase()}</span
	></span
>
