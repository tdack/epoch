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
