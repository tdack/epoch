/**
 * One-line, past-tense summaries of what a command did ("Deleted Homer Simpson"), stored in the
 * change log and shown in the undo toast.
 */

import type { TreeRows } from './change-log';
import type { RelationshipCommand } from './relationship-commands';
import { factsAtPlace } from './place-ops';
import { displayNameOf, partnerIdsOf, personName } from './tree-ops';
import { factLabel } from '../../shared/fact-types';
import { NAME_TYPE_LABELS, formatFullName, type NameType } from '../../shared/name-types';

function nameOf(rows: TreeRows, id: string): string {
	return displayNameOf(rows, id);
}

function partnershipOf(rows: TreeRows, unionId: string): string {
	const names = partnerIdsOf(rows, unionId).map((id) => nameOf(rows, id));
	return names.length >= 2 ? `the partnership between ${names.join(' and ')}` : names.length === 1 ? `${names[0]}'s partnership` : 'a partnership';
}

/** "Alex will be recorded as Sam's parent." becomes "Alex was recorded as Sam's parent." */
export function pastTense(sentence: string): string {
	return sentence.replace(/ will be /g, ' was ').replace(/ will no longer be /g, ' was no longer ');
}

/** "Occupation" for the fact a command names, whether it exists yet or not. */
function factName(rows: TreeRows, factId: string, type?: string): string {
	return factLabel(type ?? rows.events.find((e) => e.id === factId)?.type ?? 'FACT').toLowerCase();
}

function factOwner(rows: TreeRows, factId: string): string {
	const owner = rows.events.find((e) => e.id === factId)?.entityId;
	return owner ? nameOf(rows, owner) : 'someone';
}

function nameOwner(rows: TreeRows, nameId: string): string {
	const owner = rows.personNames.find((n) => n.id === nameId)?.personId;
	return owner ? nameOf(rows, owner) : 'someone';
}

/** "married name" for the name a command names, whether it exists yet or not. */
function nameKind(rows: TreeRows, nameId: string, type?: NameType): string {
	return NAME_TYPE_LABELS[type ?? (rows.personNames.find((n) => n.id === nameId)?.type as NameType | undefined) ?? 'other'].toLowerCase();
}

const PRIVACY_SENTENCES = {
	auto: (name: string) => `Set the privacy of ${name} to follow their dates`,
	public: (name: string) => `Made ${name} always public`,
	private: (name: string) => `Made ${name} always private`
} as const;

export function describeCommand(command: RelationshipCommand, rows: TreeRows): string {
	switch (command.kind) {
		case 'create_fact':
			return `Added ${factName(rows, command.factId, command.fact.type)} to ${nameOf(rows, command.personId)}`;
		case 'update_fact':
			return `Edited the ${factName(rows, command.factId)} of ${factOwner(rows, command.factId)}`;
		case 'delete_fact':
			return `Removed the ${factName(rows, command.factId)} of ${factOwner(rows, command.factId)}`;
		case 'reorder_facts':
			return `Reordered the facts of ${nameOf(rows, command.personId)}`;
		case 'rewrite_place': {
			const from = factsAtPlace(rows, command.fromKey)[0]?.place ?? 'a place';
			return `Changed the place ${from} to ${command.to.trim()}`;
		}
		case 'merge_people':
			return `Merged ${nameOf(rows, command.mergedId)} into ${nameOf(rows, command.survivorId)}`;
		case 'create_name':
			return `Added ${nameKind(rows, command.nameId, command.name.type)} ${formatFullName(command.name)} to ${nameOf(rows, command.personId)}`;
		case 'update_name':
			return `Edited the ${nameKind(rows, command.nameId)} of ${nameOwner(rows, command.nameId)}`;
		case 'delete_name':
			return `Removed the ${nameKind(rows, command.nameId)} of ${nameOwner(rows, command.nameId)}`;
		case 'reorder_names':
			return `Reordered the names of ${nameOf(rows, command.personId)}`;
		case 'set_preferred_name':
			return `Chose the ${nameKind(rows, command.nameId)} as the preferred name of ${nameOf(rows, command.personId)}`;
		case 'create_person':
			return `Added ${personName({ givenName: command.givenName, surname: command.surname })}`;
		case 'update_person':
			return `Edited ${nameOf(rows, command.personId)}`;
		case 'delete_person':
			return `Deleted ${nameOf(rows, command.personId)}`;
		case 'set_person_privacy':
			return PRIVACY_SENTENCES[command.privacy](nameOf(rows, command.personId));
		case 'record_death':
			return `Recorded the death of ${nameOf(rows, command.personId)}`;
		case 'create_union':
			return 'Added a partnership';
		case 'add_partner_to_union':
			return `Added ${nameOf(rows, command.personId)} to ${partnershipOf(rows, command.unionId)}`;
		case 'remove_partner_from_union':
			return `Removed ${nameOf(rows, command.personId)} from ${partnershipOf(rows, command.unionId)}`;
		case 'assert_parent_child':
			return `Linked ${nameOf(rows, command.parentId)} as ${nameOf(rows, command.childId)}'s ${command.type === 'unknown' ? '' : `${command.type} `}parent`;
		case 'remove_parent_child':
			return `Removed the link between ${nameOf(rows, command.parentId)} and ${nameOf(rows, command.childId)}`;
		case 'change_parent_child_type':
			return `Changed ${nameOf(rows, command.parentId)} to ${command.toType === 'unknown' ? 'an unspecified' : `a ${command.toType}`} parent of ${nameOf(rows, command.childId)}`;
		case 'destroy_union':
			return `Deleted ${partnershipOf(rows, command.unionId)}`;
		case 'end_union':
			return `Recorded ${partnershipOf(rows, command.unionId)} as ${command.status}`;
		case 'update_union':
			return `Updated ${partnershipOf(rows, command.unionId)}`;
		case 'merge_unions':
			return `Merged ${command.mergedIds.length + 1} partnerships into ${partnershipOf(rows, command.survivorId)}`;
	}
}

