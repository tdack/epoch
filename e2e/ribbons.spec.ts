/**
 * The Ribbons view: a WebGL scene with the focus line named in the DOM over it. The spheres are not
 * in the accessibility tree, so this drives the names, as the rings spec does.
 */
import { expect, open, test } from './support';

test('ribbons opens from the address and names the focus person', async ({ api, page }) => {
	const mum = await api.addPerson('Mum', 'Ribbons', { birthDate: '1930' });
	const me = await api.addPerson('Me', 'Ribbons', { birthDate: '1960' });
	await api.child(mum, me);

	await open(page, `/trees/${api.treeId}?focus=${encodeURIComponent(me.id)}&mode=ribbons`);
	const view = page.getByRole('group', { name: 'Ribbons view' });
	await expect(view).toBeVisible();
	await expect(view.getByRole('button', { name: /^Me Ribbons\b/ })).toBeVisible();
	await expect(
		page.getByRole('group', { name: 'Layout' }).getByRole('button', { name: '3D · Ribbons' })
	).toHaveAttribute('aria-pressed', 'true');
});
