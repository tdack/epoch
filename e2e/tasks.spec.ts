import { expect, open, test } from './support';

/**
 * Research tasks (ADR-029): made from a quality finding and completed, listed and filtered on the
 * tasks page, added from a person, and kept from a viewer who may not see the person they are about.
 */

test('a task is made from a quality finding, shown on it, and completed without dismissing it', async ({
	api,
	page
}) => {
	test.setTimeout(90_000);
	await api.addPerson('Dead', 'Early', { birthDate: '1900', deathDate: '1899' });
	const base = `/trees/${api.treeId}`;

	await open(page, `${base}/quality`);
	const rule = page.getByTestId('rule-death_before_birth');
	await rule.getByRole('button', { name: /Create a task for/ }).click();
	const dialog = page.getByRole('dialog', { name: 'Add a research task' });
	await expect(dialog.getByTestId('task-title')).toHaveValue(/Dead Early is recorded as dying/);
	await dialog.getByTestId('task-title').fill('Check the death date against the register');
	await dialog.getByLabel('Due (optional)').fill('2027-03-31');
	await dialog.getByRole('button', { name: 'Add task' }).click();
	await expect(dialog).toBeHidden();
	await expect(rule.getByTestId('finding-task')).toContainText(
		'Check the death date against the register'
	);
	await expect(rule.getByRole('button', { name: /Create a task for/ })).toHaveCount(0);

	// The tasks page lists it, about the person, open by default.
	await page
		.getByRole('navigation', { name: 'Tree sections' })
		.getByRole('link', { name: 'Tasks' })
		.click();
	const task = page.getByTestId('task').first();
	await expect(task).toContainText('Check the death date against the register');
	await expect(task).toContainText('Due 2027-03-31');
	await expect(task.getByRole('link', { name: 'Dead Early' })).toBeVisible();
	await task.getByRole('button', { name: /Complete the task/ }).click();
	await expect(page.getByTestId('no-tasks-page')).toBeVisible();
	await expect(page.getByTestId('task-tab-done')).toContainText('(1)');
	await page.getByTestId('task-tab-done').click();
	await expect(page.getByTestId('task').first().getByTestId('task-status')).toHaveText(/Done/);

	// Completing the task did not dismiss the finding: they are separate decisions.
	await open(page, `${base}/quality`);
	await expect(page.getByTestId('rule-death_before_birth')).toBeVisible();
	await expect(
		page.getByTestId('rule-death_before_birth').getByTestId('finding-task')
	).toContainText('(done)');
});

test('a task is added from a person, assigned and reopened, and filtered by who has it', async ({
	api,
	page
}) => {
	test.setTimeout(90_000);
	const wren = await api.addPerson('Wren', 'Ash', { birthDate: '4 MAR 1900' });
	const base = `/trees/${api.treeId}`;

	await open(page, `${base}/people/${encodeURIComponent(wren.id)}`);
	const section = page.locator('[data-section="tasks"]');
	await expect(section.getByTestId('tasks-summary')).toContainText('No research task');
	await section.getByRole('button', { name: 'Add a task about Wren Ash' }).click();
	const dialog = page.getByRole('dialog', { name: 'Add a research task' });
	// The person first, then each of their facts: the birth is the next choice.
	await dialog.getByLabel('About').selectOption({ index: 1 });
	await dialog.getByTestId('task-title').fill('Find the birth certificate');
	await dialog.getByLabel('Assigned to').selectOption({ index: 1 });
	await dialog.getByRole('button', { name: 'Add task' }).click();
	await expect(dialog).toBeHidden();
	await expect(section.getByTestId('task')).toContainText('Find the birth certificate');
	await expect(section.getByTestId('task')).toContainText('About the birth of Wren Ash');
	await expect(section.getByTestId('task-assignee')).toBeVisible();

	// Dropped, then reopened.
	await section.getByRole('button', { name: /Drop the task/ }).click();
	await expect(section.getByTestId('task-status')).toHaveText(/Dropped/);
	await section.getByRole('button', { name: /Reopen the task/ }).click();
	await expect(section.getByTestId('task-status')).toHaveText(/Open/);

	// The page filters: assigned to me, and by the kind of record.
	await open(page, `${base}/tasks?mine=true`);
	await expect(page.getByTestId('task')).toHaveCount(1);
	await open(page, `${base}/tasks?linked=union`);
	await expect(page.getByTestId('no-tasks-page')).toBeVisible();
	await open(page, `${base}/tasks?linked=event`);
	await expect(page.getByTestId('task')).toHaveCount(1);
});

test('a viewer never sees a task about a private person, title included', async ({
	api,
	page,
	browser,
	request
}) => {
	test.setTimeout(120_000);
	const sub = `e2e-tasks-viewer-${Date.now()}`;
	const old = await api.addPerson('Olda', 'Oldman', { birthDate: '1850', birthPlace: 'Cork' });
	const living = await api.addPerson('Livia', 'Aliveson', { birthDate: '1990' });
	const make = async (title: string, subject?: { kind: string; id: string }) =>
		(
			await (
				await request.post(`/api/trees/${api.treeId}/tasks`, {
					data: { title, subject: subject ?? null }
				})
			).json()
		).taskId as string;
	await make('Tidy the surnames');
	await make('Find Olda’s burial', { kind: 'person', id: old.id });
	const hiddenTask = await make('Ask Livia about her marriage', { kind: 'person', id: living.id });

	const identity = {
		'x-dev-user-sub': sub,
		'x-dev-user-email': `${sub}@epoch.test`,
		'x-dev-user-name': 'Vera Viewer'
	};
	const viewerContext = await browser.newContext({ extraHTTPHeaders: identity });
	await viewerContext.addCookies(
		Object.entries(identity).map(([name, value]) => ({
			name,
			value: encodeURIComponent(value),
			url: 'http://localhost:5179'
		}))
	);
	try {
		const invited = await request.post(`/api/trees/${api.treeId}/invitations`, {
			data: { email: identity['x-dev-user-email'], role: 'viewer' }
		});
		expect(invited.status()).toBe(201);
		expect((await viewerContext.request.get('/api/trees')).ok()).toBe(true);

		const viewer = await viewerContext.newPage();
		const base = `/trees/${api.treeId}`;
		await open(viewer, `${base}/tasks`);
		await expect(viewer.getByTestId('task')).toHaveCount(2);
		await expect(viewer.getByText('Tidy the surnames')).toBeVisible();
		await expect(viewer.getByText('Find Olda’s burial')).toBeVisible();
		await expect(viewer.getByText('Livia')).toHaveCount(0);
		await expect(viewer.getByRole('button', { name: 'Add task' })).toHaveCount(0);

		const hidden = await viewer.request.get(
			`/api/trees/${api.treeId}/tasks/${encodeURIComponent(hiddenTask)}`
		);
		const missing = await viewer.request.get(`/api/trees/${api.treeId}/tasks/no-such-task`);
		expect(hidden.status()).toBe(404);
		expect(missing.status()).toBe(404);

		// The owner sees all three.
		await open(page, `${base}/tasks`);
		await expect(page.getByTestId('task')).toHaveCount(3);
	} finally {
		await viewerContext.close();
	}
});
