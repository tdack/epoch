import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { buildRelationshipGraph } from '#lib/server/domain/relationship-graph.js';
import PersonDrawer from './PersonDrawer.svelte';

let component: Record<string, unknown> | null = null;
afterEach(() => {
	if (component) unmount(component);
	component = null;
	document.body.innerHTML = '';
});

const p = (id: string, givenName: string) => ({ id, givenName, surname: null, sex: 'U' as const, isDeceased: false });

// Ann and Ben have Cal. Ann later partners with Dee, who is not Cal's parent.
const graph = buildRelationshipGraph({
	people: [p('ann', 'Ann'), p('ben', 'Ben'), p('cal', 'Cal'), p('dee', 'Dee')],
	unions: [
		{ id: 'u1', status: 'divorced', partnerIds: ['ann', 'ben'] },
		{ id: 'u2', status: 'active', partnerIds: ['ann', 'dee'] }
	],
	parentChild: [
		{ parentId: 'ann', childId: 'cal', type: 'biological', unionId: 'u1' },
		{ parentId: 'ben', childId: 'cal', type: 'biological', unionId: 'u1' }
	]
});

function open(id: string, name: string, sex = 'U') {
	const onSelectPerson = vi.fn();
	component = mount(PersonDrawer, { target: document.body, props: { person: { id, name, sex, raw: {} }, treeId: 't', graph, onClose: vi.fn(), onSelectPerson } });
	flushSync();
	return { onSelectPerson };
}

const steps = () => document.querySelector('[data-testid="step-relatives"]');

describe('PersonDrawer step relatives', () => {
	it('lists a parent’s new partner as a step-parent, apart from parents and children', () => {
		open('cal', 'Cal');
		expect(steps()!.textContent).toContain('Dee');
		expect(steps()!.textContent).toContain('(step-parent)');
		expect(steps()!.textContent).not.toContain('Ben');
	});

	it('lists the partner’s child as a step-child, and selecting one navigates', () => {
		const { onSelectPerson } = open('dee', 'Dee');
		expect(steps()!.textContent).toContain('Cal');
		expect(steps()!.textContent).toContain('step-child, via Ann');
		steps()!.querySelector('button')!.click();
		expect(onSelectPerson).toHaveBeenCalledWith('cal');
	});

	it('shows no step section for someone with none', () => {
		open('ben', 'Ben');
		expect(steps()).toBeNull();
	});
});

describe('PersonDrawer sex', () => {
	it.each([['M', 'Male'], ['F', 'Female'], ['X', 'Other'], ['U', 'Unknown'], [undefined, 'Unknown']])('labels %s as %s', (sex, label) => {
		open('ben', 'Ben', sex as string);
		expect(document.body.textContent).toContain(`Sex: ${label}`);
	});
});
