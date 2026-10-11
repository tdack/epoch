/**
 * Task-based usability run over the Phase 1 scenarios (docs/phase-1-genealogy-core.md). Each test
 * builds one scenario through the editor alone, as a person would, then checks the stored graph
 * and what is shown. People are created through the API only to have somebody to start from; every
 * relationship, ending and death goes through the dialogs, with no GEDCOM and no notion of a FAM.
 */
import {
	addRelationship,
	card,
	chooseMenuItem,
	expect,
	openMenuByKeyboard,
	openTree,
	test
} from './support';

test('one child has two biological mothers and a separately linked biological father', async ({
	page,
	api
}) => {
	const [kid] = [
		await api.addPerson('Kid'),
		await api.addPerson('Mia'),
		await api.addPerson('Jane'),
		await api.addPerson('Dad')
	];
	await openTree(page, api, kid);
	await addRelationship(page, 'Kid', 'Add parent', { existing: 'Mia', role: 'Mother' });
	await addRelationship(page, 'Kid', 'Add parent', { existing: 'Jane', role: 'Mother' });
	await addRelationship(page, 'Kid', 'Add parent', { existing: 'Dad', role: 'Father' });

	const graph = await api.graph();
	expect(graph.parentChild.filter((l) => l.childId === kid.id).map((l) => l.type)).toEqual([
		'biological',
		'biological',
		'biological'
	]);
	expect(new Set(graph.parentChild.map((l) => l.parentId)).size).toBe(3);
	for (const name of ['Mia', 'Jane', 'Dad']) await expect(card(page, name)).toBeVisible();
});

test('one child belongs to a birth family and an adoptive family, with foster and guardian links alongside', async ({
	page,
	api
}) => {
	const kid = await api.addPerson('Kid');
	await Promise.all(['Bio', 'Adopt', 'Foster', 'Guard'].map((n) => api.addPerson(n)));
	await openTree(page, api, kid);
	await addRelationship(page, 'Kid', 'Add parent', { existing: 'Bio', type: 'Biological' });
	await addRelationship(page, 'Kid', 'Add parent', { existing: 'Adopt', type: 'Adoptive' });
	await addRelationship(page, 'Kid', 'Add parent', { existing: 'Foster', type: 'Foster' });
	await addRelationship(page, 'Kid', 'Add parent', { existing: 'Guard', type: 'Guardian' });

	const graph = await api.graph();
	expect(graph.parentChild.map((l) => l.type).sort()).toEqual([
		'adoptive',
		'biological',
		'foster',
		'guardian'
	]);
	// Each kind of parentage has its own line style in the legend and on the canvas.
	await expect(page.locator('path[data-edge-id]').first()).toBeAttached();
});

test('a divorce followed by a second partnership, with children in both, keeps them apart', async ({
	page,
	api
}) => {
	const ann = await api.addPerson('Ann');
	await Promise.all(['Ben', 'Cy'].map((n) => api.addPerson(n)));
	await openTree(page, api, ann);
	await addRelationship(page, 'Ann', 'Add partner', { existing: 'Ben' });
	await addRelationship(page, 'Ann', 'Add child', { newGiven: 'Cal' });

	await openMenuByKeyboard(page, 'Ann');
	await chooseMenuItem(page, 'End partnership…');
	const end = page.getByRole('dialog', { name: 'End partnership' });
	await end.getByLabel('Date', { exact: true }).fill('1999');
	await end.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(end).toBeHidden();

	await addRelationship(page, 'Ann', 'Add partner', { existing: 'Cy' });
	// Two partnerships now: the fuller one is the default, so the second must be chosen on purpose.
	await addRelationship(page, 'Ann', 'Add child', {
		newGiven: 'Dot',
		partnership: /Ann and Cy|Cy and Ann|Cy/
	});

	const graph = await api.graph();
	const idOf = (name: string) => graph.people.find((p) => p.displayName.startsWith(name))!.id;
	expect(graph.unions).toHaveLength(2);
	const unionOfChild = (child: string) =>
		graph.parentChild.find((l) => l.childId === idOf(child))!.unionId;
	expect(unionOfChild('Cal')).not.toBe(unionOfChild('Dot'));
	expect(graph.unions.find((u) => u.id === unionOfChild('Cal'))!.status).toBe('divorced');
	expect(graph.unions.find((u) => u.id === unionOfChild('Dot'))!.status).toBe('active');
	await expect(page.locator('path.line.partner.ended').first()).toBeAttached();
});

test('a partner’s death followed by remarriage keeps the first partnership and its child', async ({
	page,
	api
}) => {
	const eve = await api.addPerson('Eve');
	await Promise.all(['Fay', 'Gus'].map((n) => api.addPerson(n)));
	await openTree(page, api, eve);
	await addRelationship(page, 'Eve', 'Add partner', { existing: 'Fay' });
	await addRelationship(page, 'Eve', 'Add child', { newGiven: 'Hen' });

	await openMenuByKeyboard(page, 'Fay');
	await chooseMenuItem(page, 'Record death…');
	const death = page.getByRole('dialog', { name: 'Record death' });
	await death.getByLabel('Date of death').fill('2001');
	await expect(death.getByText(/will be shown as widowed/)).toBeVisible();
	await death.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(death).toBeHidden();

	await addRelationship(page, 'Eve', 'Add partner', { existing: 'Gus' });
	const graph = await api.graph();
	expect(graph.unions).toHaveLength(2);
	const first = graph.unions.find((u) =>
		u.partnerIds.some((id) => graph.people.find((p) => p.id === id)!.displayName === 'Fay')
	)!;
	// Death did not end or rewrite the partnership, and its child is still in it.
	expect(first.status).toBe('active');
	expect(first.partnerIds).toHaveLength(2);
	expect(graph.parentChild.some((l) => l.unionId === first.id)).toBe(true);
	await expect(card(page, 'Fay')).toContainText('†');
});

test('the same two people partnering again after a divorce are two partnerships, labelled 1st and 2nd', async ({
	page,
	api
}) => {
	const hal = await api.addPerson('Hal');
	await api.addPerson('Ivy');
	await openTree(page, api, hal);
	await addRelationship(page, 'Hal', 'Add partner', { existing: 'Ivy' });
	await openMenuByKeyboard(page, 'Hal');
	await chooseMenuItem(page, 'End partnership…');
	const end = page.getByRole('dialog', { name: 'End partnership' });
	await end.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(end).toBeHidden();
	await addRelationship(page, 'Hal', 'Add partner', { existing: 'Ivy' });

	expect((await api.graph()).unions).toHaveLength(2);
	await expect(page.locator('[data-union-id][aria-label^="1st partnership"]')).toBeAttached();
	await expect(page.locator('[data-union-id][aria-label^="2nd partnership"]')).toBeAttached();
	// The lines carry the same chronology, so a screen reader can tell them apart.
	await expect(
		page.locator('[data-edge-id][aria-label*=", 1st partnership."]').first()
	).toBeAttached();
	await expect(
		page.locator('[data-edge-id][aria-label*=", 2nd partnership."]').first()
	).toBeAttached();
});

test('a single or unknown parent is recorded without inventing a partnership', async ({
	page,
	api
}) => {
	const [solo] = [await api.addPerson('Solo')];
	await openTree(page, api, solo);
	await addRelationship(page, 'Solo', 'Add child', { newGiven: 'Wren' });
	await addRelationship(page, 'Solo', 'Add parent', {
		newGiven: 'Unknown',
		type: 'Unknown / other'
	});

	const graph = await api.graph();
	expect(graph.unions).toHaveLength(0);
	expect(graph.parentChild.map((l) => [l.type, l.unionId])).toEqual([
		['biological', null],
		['unknown', null]
	]);
});

test('approximate, before, after, range and phrase dates are kept exactly as entered', async ({
	page,
	api
}) => {
	const dates = ['ABT 1900', 'BEF 1950', 'AFT 1875', 'BET 1860 AND 1865', '(when the river froze)'];
	const people = await Promise.all(dates.map((_, i) => api.addPerson(`Dee${i}`)));
	for (const [i, date] of dates.entries()) {
		await openTree(page, api, people[i]);
		await openMenuByKeyboard(page, `Dee${i}`);
		await chooseMenuItem(page, 'Record death…');
		const dialog = page.getByRole('dialog', { name: 'Record death' });
		await dialog.getByLabel('Date of death').fill(date);
		await dialog.getByRole('button', { name: 'Save', exact: true }).click();
		await expect(dialog).toBeHidden();
	}
	// Nobody is related to anybody, so each person is a window of their own.
	const deaths = await Promise.all(
		people.map(async (person) => (await api.graph(person.id)).people[0]!.deathDate)
	);
	expect(deaths).toEqual(dates);
});

test('a death dated before the birth is flagged before saving, but can still be saved', async ({
	page,
	api
}) => {
	const p = await api.addPerson('Old', null, { birthDate: '1950' });
	await openTree(page, api, p);
	await openMenuByKeyboard(page, 'Old');
	await chooseMenuItem(page, 'Record death…');
	const dialog = page.getByRole('dialog', { name: 'Record death' });
	await dialog.getByLabel('Date of death').fill('1940');
	await expect(
		dialog.getByText('This death date is earlier than the recorded birth.')
	).toBeVisible();
	await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
});
