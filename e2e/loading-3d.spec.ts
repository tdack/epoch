/**
 * Choosing someone refetches the graph, so the chart is stale for a moment. A badge says so until
 * the new view is drawn (S16 follow-up).
 */
import { expect, open, test } from './support';

for (const mode of ['layers', 'floors', 'flat'] as const) {
	test(`${mode}: choosing a person shows a loading badge until the new view is drawn`, async ({
		page,
		api
	}) => {
		const john = await api.addPerson('John', 'Load');
		const kit = await api.addPerson('Kit', 'Load');
		await api.child(john, kit);
		const card = (name: string) =>
			page.locator('[data-person-id]').filter({ hasText: new RegExp(`${name} Load`) });
		const badge = page.getByRole('status').filter({ hasText: 'Loading' });

		await open(
			page,
			`/trees/${api.treeId}?focus=${encodeURIComponent(john.id)}&up=1&down=1&mode=${mode}`
		);
		await expect(card('Kit')).toBeVisible();
		await expect(badge).toHaveCount(0);

		// Hold the graph request so the wait is long enough to see.
		await page.route('**/graph?**', async (route) => {
			await new Promise((resolve) => setTimeout(resolve, 1500));
			await route.continue();
		});
		await card('Kit').click();
		await expect(badge).toBeVisible();
		await expect(badge).toHaveCount(0);
		await expect(card('Kit')).toHaveAttribute('aria-label', /focus person/);
	});
}
