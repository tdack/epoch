/** What the relationship calculator answers, as the screen reads it. */

export interface KinPersonRef {
	id: string;
	name: string;
	/** A placeholder for someone the viewer may not see: no name, nothing to open. */
	isPrivate: boolean;
}

export interface KinStepDto extends KinPersonRef {
	/** What this person is to the one before; null for the first. */
	relation: 'parent' | 'child' | 'partner' | null;
	/** biological, adoptive, foster, guardian or unknown, for a parent or child step. */
	linkType: string | null;
}

export interface KinRouteDto {
	kind: 'self' | 'partner' | 'blood' | 'by-partnership';
	/** What the second person is to the first, e.g. "1st cousin once removed". */
	label: string;
	steps: KinStepDto[];
	/** The common ancestors the route runs through, by name. */
	viaNames: string[];
	/** Link types on the route that are not biological. */
	nonBiologicalTypes: string[];
}

export interface RelationshipDto {
	from: KinPersonRef;
	to: KinPersonRef;
	routes: KinRouteDto[];
	/** The search hit its generation or size limit; "not related" cannot be concluded. */
	isIncomplete: boolean;
}

const OF_A_PARTNER = / of partner$/;

/**
 * The sentence a route is shown as. A blood or partner label reads as "Y is X's 1st cousin"; a
 * route by partnership has two shapes ("partner of 1st cousin", "1st cousin of partner") that
 * would read wrongly in that frame, and the fixed terms (step-parent, sibling-in-law) read fine in it.
 */
export function routeSentence(
	fromName: string,
	toName: string,
	route: Pick<KinRouteDto, 'kind' | 'label'>
): string {
	if (route.kind === 'self') return `${fromName} is the same person.`;
	if (route.kind === 'by-partnership') {
		if (route.label.startsWith('partner of '))
			return `${toName} is the partner of ${fromName}'s ${route.label.slice('partner of '.length)}.`;
		if (OF_A_PARTNER.test(route.label))
			return `${toName} is the ${route.label.replace(OF_A_PARTNER, '')} of ${fromName}'s partner.`;
	}
	return `${toName} is ${fromName}'s ${route.label}.`;
}
