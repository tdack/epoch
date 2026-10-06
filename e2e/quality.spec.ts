import AxeBuilder from '@axe-core/playwright';
import { expect, open, test } from './support';

const SHOTS = process.env.E2E_SHOTS ?? 'test-results';

test('the quality report lists what the record contradicts, links to it, and a dismissal needs a reason and can be undone', async ({
	api,
	page
}) => {
	await api.addPerson('Dead', 'Early', { birthDate: '1900', deathDate: '1899' });
	const parent = await api.addPerson('Parent', 'Early', { birthDate: '1900', deathDate: '1950' });
	const kid = await api.addPerson('Kid', 'Early', { birthDate: '1890', deathDate: '1960' });
	await api.child(parent, kid);

	await open(page, `/trees/${api.treeId}`);
	await page
		.getByRole('navigation', { name: 'Tree sections' })
		.getByRole('button', { name: 'More' })
		.click();
	await page.getByRole('menuitem', { name: 'Quality' }).click();
	await expect(page.getByRole('heading', { name: 'Data quality' })).toBeVisible();

	const deathRule = page.getByTestId('rule-death_before_birth');
	await expect(deathRule).toContainText('Dead Early is recorded as dying before they were born');
	await expect(page.getByTestId('rule-child_before_parent')).toContainText(
		'Kid Early was born before their parent Parent Early'
	);
	await expect(page.getByTestId('rule-one_parent_recorded')).toContainText(
		'Kid Early has only one parent recorded'
	);
	// The most serious come first.
	await expect(page.getByRole('heading', { level: 3 }).first()).toHaveText('Warnings');
	await page.screenshot({ path: `${SHOTS}/quality.png`, fullPage: true });

	const found = await new AxeBuilder({ page })
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
		.analyze();
	expect(found.violations.map((v) => `${v.id} ${v.nodes[0]?.target?.join(' ')}`)).toEqual([]);

	// A finding links to the person it is about.
	await deathRule.getByRole('link', { name: 'Dead Early' }).click();
	await expect(page.getByTestId('person-name')).toHaveText('Dead Early');
	await page.goBack();

	// A reason is required, and the form closes on cancel.
	await deathRule.getByRole('button', { name: 'Dismiss' }).click();
	await expect(deathRule.getByRole('button', { name: 'Dismiss' }).last()).toBeDisabled();
	await deathRule.getByRole('button', { name: 'Cancel' }).click();
	await expect(deathRule.getByLabel('Why is this fine?')).toHaveCount(0);

	await deathRule.getByRole('button', { name: 'Dismiss' }).click();
	await deathRule.getByLabel('Why is this fine?').fill('The register says so');
	await deathRule.getByRole('button', { name: 'Dismiss' }).last().click();
	await expect(page.getByText('Finding dismissed')).toBeVisible();
	await expect(page.getByTestId('rule-death_before_birth')).toHaveCount(0);
	await expect(page.getByTestId('dismissed')).toContainText('The register says so');
	await expect(page.getByTestId('quality-total')).toContainText('1 dismissed');

	await page.getByTestId('dismissed').getByRole('button', { name: 'Restore' }).click();
	await expect(page.getByTestId('rule-death_before_birth')).toBeVisible();
	await expect(page.getByTestId('dismissed')).toHaveCount(0);
});
