/**
 * What clicking a relative does. It is the one real difference between the drawer and the person
 * page, so the view takes it as a single input instead of forking templates.
 */
export type RelativeTarget =
	/** On the canvas a relative is selected in place. */
	| { kind: 'select'; onSelect: (id: string) => void }
	/** On the page a relative is a link to their page. */
	| { kind: 'link' };

export const LINK_TARGET: RelativeTarget = { kind: 'link' };
