/** Fixtures and graph builders shared by the layout test suites. Not imported by app code. */

import type {
	RelationshipGraph,
	RelationshipGraphPerson,
	RelationshipGraphUnion
} from './types.js';
import type { ParentChildType } from '#lib/server/domain/genealogy-model.js';
import { buildRelationshipGraph } from '#lib/server/domain/relationship-graph.js';
import simpsons from './fixtures/littles.graph.json';
import simpsonsDirty from './fixtures/littles-dirty.graph.json';
import representative551 from './fixtures/representative-551.graph.json';
import representative7 from './fixtures/representative-7.graph.json';

export interface NamedGraph {
	name: string;
	graph: RelationshipGraph;
}

/** Graphs captured from the running app after importing each GEDCOM through POST /api/import. */
export const CAPTURED_GRAPHS: NamedGraph[] = [
	{ name: 'simpsons', graph: simpsons as unknown as RelationshipGraph },
	{ name: 'simpsons-dirty', graph: simpsonsDirty as unknown as RelationshipGraph },
	{ name: 'representative-551', graph: representative551 as unknown as RelationshipGraph },
	{ name: 'representative-7', graph: representative7 as unknown as RelationshipGraph }
];

export interface PersonSpec {
	id: string;
	sex?: 'M' | 'F' | 'X' | 'U' | null;
}
export interface UnionSpec {
	id: string;
	partners: string[];
	children?: Array<string | { id: string; type?: ParentChildType; parents?: string[] }>;
	marriageDate?: string;
	status?: RelationshipGraphUnion['status'];
}
export interface DirectSpec {
	parentId: string;
	childId: string;
	type?: ParentChildType;
}

/**
 * Build a graph for a synthetic scenario. A union's children are asserted for every partner
 * unless `parents` narrows it, matching how the importer records `FAM` children.
 */
export function makeGraph(input: {
	people: Array<string | PersonSpec>;
	unions?: UnionSpec[];
	direct?: DirectSpec[];
}): RelationshipGraph {
	const people = input.people.map((p) => (typeof p === 'string' ? { id: p } : p));
	const parentChild: RelationshipGraph['parentChild'] = [];
	const unions = (input.unions ?? []).map((u) => {
		for (const child of u.children ?? []) {
			const spec = typeof child === 'string' ? { id: child } : child;
			for (const parentId of spec.parents ?? u.partners) {
				parentChild.push({
					parentId,
					childId: spec.id,
					type: spec.type ?? 'biological',
					unionId: u.id
				});
			}
		}
		return {
			id: u.id,
			status: u.status ?? ('active' as const),
			marriageDate: u.marriageDate ?? null,
			partnerIds: u.partners
		};
	});
	for (const d of input.direct ?? []) {
		parentChild.push({
			parentId: d.parentId,
			childId: d.childId,
			type: d.type ?? 'biological',
			unionId: null
		});
	}
	return buildRelationshipGraph({
		people: people.map((p) => ({
			id: p.id,
			givenName: p.id,
			surname: null,
			sex: p.sex ?? 'U',
			isDeceased: false
		})),
		unions,
		parentChild
	});
}

export function personByName(graph: RelationshipGraph, name: string): RelationshipGraphPerson {
	const found = graph.people.find((p) => p.displayName === name);
	if (!found) throw new Error(`No person named ${name}`);
	return found;
}

/** Hand-built scenarios for structures the captured data does not contain. */
export const SYNTHETIC_GRAPHS: NamedGraph[] = [
	{
		// Kid1 and Kid2 are cousins (their parents A and B are siblings), and they have a child
		// C together, so C reaches the grandparents G1+G2 by two paths.
		name: 'cousin-marriage',
		graph: makeGraph({
			people: ['G1', 'G2', 'A', 'B', 'SpouseA', 'SpouseB', 'Kid1', 'Kid2', 'C'],
			unions: [
				{ id: 'ug', partners: ['G1', 'G2'], children: ['A', 'B'] },
				{ id: 'ua', partners: ['A', 'SpouseA'], children: ['Kid1'] },
				{ id: 'ub', partners: ['B', 'SpouseB'], children: ['Kid2'] },
				{ id: 'uc', partners: ['Kid1', 'Kid2'], children: ['C'] }
			]
		})
	},
	{
		name: 'direct-links-only',
		graph: makeGraph({
			people: ['Parent', 'Kid1', 'Kid2', 'Grand'],
			direct: [
				{ parentId: 'Parent', childId: 'Kid1' },
				{ parentId: 'Parent', childId: 'Kid2', type: 'adoptive' },
				{ parentId: 'Grand', childId: 'Parent' }
			]
		})
	},
	{
		name: 'three-unions',
		graph: makeGraph({
			people: ['Pat', 'Q1', 'Q2', 'Q3', 'K1', 'K2', 'K3'],
			unions: [
				{ id: 'u1', partners: ['Pat', 'Q1'], marriageDate: '1990', children: ['K1'] },
				{ id: 'u2', partners: ['Pat', 'Q2'], marriageDate: '1995', children: ['K2'] },
				{ id: 'u3', partners: ['Pat', 'Q3'], marriageDate: '2001', children: ['K3'] }
			]
		})
	},
	{
		name: 'childless-and-solo',
		graph: makeGraph({
			people: ['A', 'B', 'C', 'D'],
			unions: [
				{ id: 'u1', partners: ['A', 'B'] },
				{ id: 'u2', partners: ['C'], children: ['D'] }
			]
		})
	},
	{
		// One child asserted in three unions between the same pair: each union is a distinct node.
		name: 'repeated-union-shared-child',
		graph: makeGraph({
			people: ['A', 'B', 'K'],
			unions: [
				{
					id: 'u1',
					partners: ['A', 'B'],
					marriageDate: '1980',
					status: 'divorced',
					children: ['K']
				},
				{
					id: 'u2',
					partners: ['A', 'B'],
					marriageDate: '1990',
					status: 'divorced',
					children: ['K']
				},
				{ id: 'u3', partners: ['A', 'B'], marriageDate: '2000', children: ['K'] }
			]
		})
	},
	{
		name: 'repeated-union',
		graph: makeGraph({
			people: ['A', 'B', 'K1', 'K2'],
			unions: [
				{
					id: 'u1',
					partners: ['A', 'B'],
					marriageDate: '1980',
					status: 'divorced',
					children: ['K1']
				},
				{ id: 'u2', partners: ['A', 'B'], marriageDate: '1990', children: ['K2'] }
			]
		})
	}
];

export function allTestGraphs(): NamedGraph[] {
	return [...CAPTURED_GRAPHS, ...SYNTHETIC_GRAPHS];
}
