import { expect, open, test } from './support';

const SHOTS = process.env.E2E_SHOTS ?? 'test-results';

test('the pedigree and descendant charts draw the family, and follow a card', async ({ api, page }) => {
	const gran = await api.addPerson('Granny', 'Chartly', { birthDate: '1850', deathDate: '1920' });
	const gramp = await api.addPerson('Grampy', 'Chartly', { birthDate: '1848', deathDate: '1919' });
	const dad = await api.addPerson('Dadly', 'Chartly', { birthDate: '1880', deathDate: '1950' });
	const mum = await api.addPerson('Mumly', 'Chartly', { birthDate: '1884', deathDate: '1960' });
	const me = await api.addPerson('Minnie', 'Chartly', { birthDate: '1910', deathDate: '1990' });
	const sib = await api.addPerson('Sibley', 'Chartly', { birthDate: '1912', deathDate: '1992' });
	await api.child(gran, dad);
	await api.child(gramp, dad);
	await api.child(dad, me);
	await api.child(mum, me);
	await api.child(dad, sib);

	await open(page, `/trees/${api.treeId}/people/${encodeURIComponent(me.id)}/pedigree`);
	await expect(page.getByRole('heading', { name: 'Ancestors of Minnie Chartly' })).toBeVisible();
	await expect(page.getByTestId('generations')).toHaveText('4');
	await expect(page.getByTestId('chart-card')).toHaveCount(5);
	await page.screenshot({ path: `${SHOTS}/pedigree.png` });

	// A card leads to the chart of that person.
	await page.getByRole('link', { name: /Dadly Chartly/ }).click();
	await expect(page.getByRole('heading', { name: 'Ancestors of Dadly Chartly' })).toBeVisible();
	await expect(page.getByTestId('chart-card')).toHaveCount(3);

	// One generation is only the person; the control is a link, so the depth is in the address.
	await page.getByRole('link', { name: 'Fewer generations' }).click();
	await expect(page).toHaveURL(/generations=3/);
	await page.goto(`/trees/${api.treeId}/people/${encodeURIComponent(me.id)}/pedigree?generations=2`);
	await expect(page.getByTestId('chart-card')).toHaveCount(3);
	await expect(page.getByTestId('more')).toContainText('Further ancestors');

	await open(page, `/trees/${api.treeId}/people/${encodeURIComponent(dad.id)}/descendants`);
	await expect(page.getByRole('heading', { name: 'Descendants of Dadly Chartly' })).toBeVisible();
	await expect(page.getByTestId('chart-card')).toHaveCount(3);
	await page.screenshot({ path: `${SHOTS}/descendants.png` });

	// The list nests each child under their parent: Minnie and Sibley are Dadly's children.
	await page.getByText('The same descendants as a list').click();
	const tree = page.getByTestId('descendant-outline');
	await expect(tree.getByRole('listitem')).toHaveCount(3);
	await expect(tree.getByRole('listitem').first()).toContainText('Dadly Chartly');
	await expect(tree.getByRole('listitem').first().getByRole('list').getByRole('listitem')).toHaveCount(2);
	await expect(tree.getByRole('link', { name: 'Minnie Chartly' })).toBeVisible();

	// The person page links to both.
	await open(page, `/trees/${api.treeId}/people/${encodeURIComponent(me.id)}`);
	await page.getByRole('link', { name: 'Ancestors', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Ancestors of Minnie Chartly' })).toBeVisible();
});

test('the fan and hourglass charts draw the same family, link between styles and list the ancestors as text', async ({ api, page }) => {
	const gran = await api.addPerson('Granny', 'Fanley', { birthDate: '1850', deathDate: '1920' });
	const dad = await api.addPerson('Dadly', 'Fanley', { birthDate: '1880', deathDate: '1950' });
	const mum = await api.addPerson('Mumly', 'Fanley', { birthDate: '1884', deathDate: '1960' });
	const me = await api.addPerson('Minnie', 'Fanley', { birthDate: '1910', deathDate: '1990' });
	const kid = await api.addPerson('Kiddo', 'Fanley', { birthDate: '1935', deathDate: '2000' });
	await api.child(gran, dad);
	await api.child(dad, me);
	await api.child(mum, me);
	await api.child(me, kid);

	await open(page, `/trees/${api.treeId}/people/${encodeURIComponent(me.id)}/fan`);
	await expect(page.getByRole('heading', { name: 'Fan chart of Minnie Fanley' })).toBeVisible();
	await expect(page.getByTestId('chart-card')).toHaveCount(4);
	await page.screenshot({ path: `${SHOTS}/fan.png` });

	// The list says the same thing in words, numbered so a parent is twice the child.
	await page.getByText('The same ancestors as a list').click();
	const outline = page.getByTestId('outline').getByRole('listitem');
	await expect(outline).toHaveCount(4);
	await expect(outline.nth(0)).toContainText('Minnie Fanley');
	// Which parent comes first is the pedigree's order, not a claim about who they are.
	await expect(page.getByTestId('outline')).toContainText('Dadly Fanley');
	await expect(page.getByTestId('outline')).toContainText('Mumly Fanley');
	await expect(outline.nth(1)).toContainText('parent of 1');
	await expect(outline.nth(3)).toContainText('Granny Fanley');

	// A wedge leads to that person's fan; the style links keep the person and the depth.
	await page.getByRole('link', { name: /Dadly Fanley/ }).first().click();
	await expect(page.getByRole('heading', { name: 'Fan chart of Dadly Fanley' })).toBeVisible();
	await page.getByRole('navigation', { name: 'Chart style' }).getByRole('link', { name: 'Hourglass' }).click();
	await expect(page.getByRole('heading', { name: 'Hourglass of Dadly Fanley' })).toBeVisible();
	await expect(page).toHaveURL(/up=4&down=4/);

	await open(page, `/trees/${api.treeId}/people/${encodeURIComponent(me.id)}/hourglass`);
	await expect(page.getByTestId('up')).toHaveText('3');
	await expect(page.getByTestId('down')).toHaveText('3');
	// Granny, Dadly, Mumly, Minnie once, and Kiddo.
	await expect(page.getByTestId('chart-card')).toHaveCount(5);
	await page.screenshot({ path: `${SHOTS}/hourglass.png` });

	// Both halves are also lists: Minnie's own line, then the ancestors.
	await page.getByText('Descendants as a list').click();
	await page.getByText('Ancestors as a list').click();
	await expect(page.getByTestId('descendant-outline').getByRole('listitem')).toHaveCount(2);
	await expect(page.getByTestId('descendant-outline')).toContainText('Kiddo');
	await expect(page.getByTestId('outline').getByRole('listitem')).toHaveCount(4);

	await page.getByRole('link', { name: 'Fewer descendants' }).click();
	await expect(page).toHaveURL(/up=3&down=2/);
	await expect(page.getByTestId('chart-card')).toHaveCount(5);
	await page.getByRole('link', { name: 'Fewer descendants' }).click();
	await page.getByRole('link', { name: 'Fewer descendants' }).click();
	await expect(page.getByTestId('down')).toHaveText('1');
	await expect(page.getByTestId('chart-card')).toHaveCount(4);

	// The person page links to both new styles.
	await open(page, `/trees/${api.treeId}/people/${encodeURIComponent(me.id)}`);
	await page.getByRole('link', { name: 'Fan', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Fan chart of Minnie Fanley' })).toBeVisible();
});
