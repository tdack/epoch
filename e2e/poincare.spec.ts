/**
 * The Ball view: a WebGL scene with the focus line named in the DOM over it. The spheres are not
 * in the accessibility tree, so this drives the names, as the rings spec does.
 */
import { expect, open, test } from './support';

test('poincare opens from the address and names the focus person', async ({ api, page }) => {
	const mum = await api.addPerson('Mum', 'Poincare', { birthDate: '1930' });
	const me = await api.addPerson('Me', 'Poincare', { birthDate: '1960' });
	await api.child(mum, me);

	await open(page, `/trees/${api.treeId}?focus=${encodeURIComponent(me.id)}&mode=poincare`);
	const view = page.getByRole('group', { name: 'Ball view' });
	await expect(view).toBeVisible();
	await expect(view.getByRole('button', { name: /^Me Poincare\b/ })).toBeVisible();
	await expect(
		page.getByRole('group', { name: 'Layout' }).getByRole('button', { name: '3D · Ball' })
	).toHaveAttribute('aria-pressed', 'true');
});
