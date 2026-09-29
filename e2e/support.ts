import { test as base, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';

/** A person as the API returns it after creation. */
export interface Person {
	id: string;
	givenName: string;
	surname: string | null;
	version: number;
}

export interface GraphView {
	people: Array<{ id: string; displayName: string; isDeceased: boolean; deathDate: string | null; version?: number }>;
	unions: Array<{ id: string; status: string; partnerIds: string[]; version?: number; events?: Array<{ type: string; dateText: string | null; place: string | null }> }>;
	parentChild: Array<{ parentId: string; childId: string; type: string; unionId: string | null }>;
}

export class Api {
	constructor(
		private request: APIRequestContext,
		readonly treeId: string
	) {}

	async addPerson(givenName: string, surname: string | null = null, extra: Record<string, unknown> = {}): Promise<Person> {
		const res = await this.request.post(`/api/trees/${this.treeId}/individuals`, { data: { givenName, surname, ...extra } });
		expect(res.ok()).toBe(true);
		return (await res.json()).individual;
	}

	async relate(intent: Record<string, unknown>) {
		const res = await this.request.post(`/api/trees/${this.treeId}/relationships`, { data: { intent } });
		expect(res.ok(), await res.text()).toBe(true);
	}

	private ref = (p: Person) => ({ id: p.id, givenName: p.givenName, surname: p.surname });

	partner(a: Person, b: Person) {
		return this.relate({ kind: 'add_partner', person: this.ref(a), partner: this.ref(b), unionLabel: null });
	}

	child(parent: Person, child: Person) {
		return this.relate({ kind: 'add_child', parent: this.ref(parent), child: this.ref(child), type: 'biological', unionLabel: null });
	}

	parent(child: Person, parent: Person) {
		return this.relate({ kind: 'add_parent', child: this.ref(child), parent: this.ref(parent), type: 'biological', role: 'parent', unionLabel: null });
	}

	async graph(): Promise<GraphView> {
		const res = await this.request.get(`/api/trees/${this.treeId}/graph`);
		return (await res.json()).graph;
	}
}

/** A fresh, uniquely named tree per test, deleted afterwards. */
export const test = base.extend<{ api: Api }>({
	api: async ({ request }, use) => {
		const created = await request.post('/api/trees', { data: { name: `e2e ${Date.now()}-${Math.random().toString(36).slice(2, 7)}` } });
		expect(created.ok()).toBe(true);
		const treeId = (await created.json()).tree.id as string;
		await use(new Api(request, treeId));
		await request.delete(`/api/trees/${treeId}`);
	}
});

export { expect };

export function card(page: Page, name: string | RegExp): Locator {
	return page.locator('[data-person-id]').filter({ hasText: name }).first();
}

/** Open the tree focused on a person. */
export async function openTree(page: Page, api: Api, focus: Person) {
	await page.goto(`/?tree=${api.treeId}&focus=${encodeURIComponent(focus.id)}`);
	await expect(card(page, focus.givenName)).toBeVisible();
}

/** Open a card's context menu from the keyboard, as Shift+F10 does. */
export async function openMenuByKeyboard(page: Page, name: string | RegExp) {
	await card(page, name).focus();
	await page.keyboard.press('Shift+F10');
	await expect(page.getByRole('menu')).toBeVisible();
}

/** Pick a menu item with the arrow keys and Enter. */
export async function chooseMenuItem(page: Page, label: string) {
	const items = page.getByRole('menuitem');
	const labels = await items.allTextContents();
	const target = labels.findIndex((l) => l.trim() === label);
	expect(target, `menu has "${label}" in ${JSON.stringify(labels)}`).toBeGreaterThanOrEqual(0);
	for (let i = 0; i < target; i++) await page.keyboard.press('ArrowDown');
	await page.keyboard.press('Enter');
}

/** Focus a control and press Enter, the way a keyboard user activates it. */
export async function activate(locator: Locator) {
	await locator.focus();
	await locator.press('Enter');
}

export interface RelationshipForm {
	/** An existing person, found by searching their name. */
	existing?: string;
	/** Or a new person, by given name. */
	newGiven?: string;
	/** The option label, e.g. "Adoptive". */
	type?: string;
	/** The role option label for add parent, e.g. "Mother". */
	role?: string;
	/** Text that identifies the partnership to pick in the chooser, e.g. /2nd partnership/. */
	partnership?: string | RegExp;
}

/**
 * Add a parent, child or partner the way a person would: from the card's menu, through the
 * relationship dialog, waiting for the preview sentence before saving. Nothing here touches the API.
 */
export async function addRelationship(page: Page, anchor: string, kind: 'Add parent' | 'Add child' | 'Add partner', form: RelationshipForm) {
	const unionsBefore = await page.locator('[data-union-id]').count();
	await openMenuByKeyboard(page, anchor);
	await chooseMenuItem(page, 'Add relationship');
	const dialog = page.getByRole('dialog', { name: 'Add relationship' });
	await dialog.getByRole('button', { name: kind, exact: true }).click();
	if (form.type) await dialog.getByLabel('Relationship type').selectOption({ label: form.type });
	if (form.role) await dialog.getByLabel('Role').selectOption({ label: form.role });
	if (form.newGiven) {
		await dialog.getByRole('button', { name: 'New person' }).click();
		await dialog.getByLabel('Given name').fill(form.newGiven);
	} else if (form.existing) {
		await dialog.getByLabel('Search people by name').fill(form.existing);
		await dialog.getByLabel('Search people by name').press('Enter');
		await dialog.getByRole('list', { name: 'Search results' }).getByRole('button', { name: new RegExp(form.existing) }).first().click();
	}
	if (form.partnership) await dialog.getByTestId('union-chooser').getByRole('radio', { name: form.partnership }).check();
	// The preview is the promise of what will be saved; wait for it, then save.
	await expect(dialog.getByText(/will be recorded as/)).toBeVisible();
	await dialog.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(dialog).toBeHidden();
	// The canvas redraws after the save; wait for it so the next step starts from what is shown.
	const other = form.newGiven ?? form.existing;
	if (other) await expect(card(page, other)).toBeVisible();
	if (kind === 'Add partner') await expect(page.locator('[data-union-id]')).toHaveCount(unionsBefore + 1);
}
