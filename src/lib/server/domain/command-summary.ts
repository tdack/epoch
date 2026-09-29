/**
 * One-line, past-tense summaries of what a command did ("Deleted Homer Simpson"), stored in the
 * change log and shown in the undo toast.
 */

import type { TreeRows } from './change-log';
import type { RelationshipCommand } from './relationship-commands';
import { partnerIdsOf, personName } from './tree-ops';

function nameOf(rows: TreeRows, id: string): string {
	return personName(rows.individuals.find((p) => p.id === id));
}

function partnershipOf(rows: TreeRows, unionId: string): string {
	const names = partnerIdsOf(rows, unionId).map((id) => nameOf(rows, id));
	return names.length >= 2 ? `the partnership between ${names.join(' and ')}` : names.length === 1 ? `${names[0]}'s partnership` : 'a partnership';
}

/** "Alex will be recorded as Sam's parent." becomes "Alex was recorded as Sam's parent." */
export function pastTense(sentence: string): string {
	return sentence.replace(/ will be /g, ' was ').replace(/ will no longer be /g, ' was no longer ');
}

export function describeCommand(command: RelationshipCommand, rows: TreeRows): string {
	switch (command.kind) {
		case 'create_person':
			return `Added ${personName({ givenName: command.givenName, surname: command.surname })}`;
		case 'update_person':
			return `Edited ${nameOf(rows, command.personId)}`;
		case 'delete_person':
			return `Deleted ${nameOf(rows, command.personId)}`;
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
		case 'destroy_union':
			return `Deleted ${partnershipOf(rows, command.unionId)}`;
		case 'end_union':
			return `Recorded ${partnershipOf(rows, command.unionId)} as ${command.status}`;
		case 'update_union':
			return `Updated ${partnershipOf(rows, command.unionId)}`;
	}
}

