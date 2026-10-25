/**
 * Writes notes through the mutation runner, so every change is previewed, logged and undoable like
 * any other (ADR-029). Reads for the notes pages and the record pages live in `note-read-service.ts`
 * and the page services.
 */

import type { DbClient } from '../db';
import { describeCommand } from '../domain/command-summary';
import type { NoteCommand } from '../domain/note-ops';
import type { AuthenticatedContext } from '../domain/identity';
import type { ImpactSummary } from '../../shared/impact';
import type { NoteSubjectRef, SharedNoteInput } from '../../shared/notes';
import { isActionAllowed, type TreeAction } from '../auth/authorization';
import { UserRepository } from '../repositories/user-repository';
import { requireTreeAction } from './tree-access';
import { MutationRunner, type MutationClock, type MutationResult } from './mutation-runner';

/**
 * The right a command needs, so a caller who lacks it is refused before the command is planned. A
 * plan can fail with a domain error that says something about the records (a note in use, with how
 * many records use it), and that must not be what a role without the right is told.
 */
const REQUIRED_ACTION: Record<NoteCommand['kind'], TreeAction> = {
	add_note: 'record:create',
	attach_note: 'record:create',
	create_note: 'record:create',
	// Sharing rewrites the note on its record to point at a new shared one: an edit of it.
	share_note: 'record:edit',
	update_note: 'record:edit',
	update_shared_note: 'record:edit',
	reorder_notes: 'record:edit',
	remove_note: 'record:delete',
	delete_shared_note: 'record:delete',
	merge_notes: 'record:delete'
};

export class NoteService {
	readonly runner: MutationRunner;
	private users: UserRepository;

	constructor(db: DbClient, clock?: MutationClock) {
		this.runner = new MutationRunner(db, clock);
		this.users = new UserRepository(db);
	}

	/**
	 * The access check, and the command as this caller may run it. Moving a fact's legacy description
	 * into a new note edits the fact, so a caller who may only create leaves the description alone
	 * rather than being refused the note; the runner still checks every op it writes.
	 */
	private async permitted(
		treeId: string,
		command: NoteCommand,
		context: AuthenticatedContext
	): Promise<NoteCommand> {
		const role = await requireTreeAction(
			this.users,
			treeId,
			context,
			REQUIRED_ACTION[command.kind]
		);
		return command.kind === 'add_note'
			? { ...command, shouldMoveLegacyDescription: isActionAllowed(role, 'record:edit') }
			: command;
	}

	private async run(
		treeId: string,
		requested: NoteCommand,
		context: AuthenticatedContext
	): Promise<MutationResult> {
		const command = await this.permitted(treeId, requested, context);
		return this.runner.run(treeId, context, {
			kind: command.kind,
			summary: (rows) => describeCommand(command, rows),
			commands: [command]
		});
	}

	/** What a note change would write, without writing it. */
	async preview(
		treeId: string,
		requested: NoteCommand,
		context: AuthenticatedContext
	): Promise<ImpactSummary> {
		const command = await this.permitted(treeId, requested, context);
		return this.runner.preview(treeId, context, [command], (rows) =>
			describeCommand(command, rows)
		);
	}

	async addNote(
		treeId: string,
		subject: NoteSubjectRef,
		text: string,
		context: AuthenticatedContext
	): Promise<{ attachmentId: string } & MutationResult> {
		const attachmentId = this.runner.clock.newId();
		const result = await this.run(
			treeId,
			{ kind: 'add_note', attachmentId, subject, text },
			context
		);
		return { attachmentId, ...result };
	}

	updateNote(
		treeId: string,
		attachmentId: string,
		text: string,
		expectedVersion: number,
		context: AuthenticatedContext
	) {
		return this.run(treeId, { kind: 'update_note', attachmentId, expectedVersion, text }, context);
	}

	removeNote(
		treeId: string,
		attachmentId: string,
		expectedVersion: number | undefined,
		context: AuthenticatedContext
	) {
		return this.run(treeId, { kind: 'remove_note', attachmentId, expectedVersion }, context);
	}

	reorderNotes(
		treeId: string,
		subject: NoteSubjectRef,
		orderedAttachmentIds: string[],
		context: AuthenticatedContext
	) {
		return this.run(treeId, { kind: 'reorder_notes', subject, orderedAttachmentIds }, context);
	}

	async shareNote(
		treeId: string,
		attachmentId: string,
		expectedVersion: number | undefined,
		context: AuthenticatedContext
	): Promise<{ noteId: string } & MutationResult> {
		const noteId = this.runner.clock.newId();
		const result = await this.run(
			treeId,
			{ kind: 'share_note', attachmentId, noteId, expectedVersion },
			context
		);
		return { noteId, ...result };
	}

	async attachNote(
		treeId: string,
		subject: NoteSubjectRef,
		noteId: string,
		context: AuthenticatedContext
	): Promise<{ attachmentId: string } & MutationResult> {
		const attachmentId = this.runner.clock.newId();
		const result = await this.run(
			treeId,
			{ kind: 'attach_note', attachmentId, subject, noteId },
			context
		);
		return { attachmentId, ...result };
	}

	async createNote(
		treeId: string,
		note: SharedNoteInput,
		context: AuthenticatedContext
	): Promise<{ noteId: string } & MutationResult> {
		const noteId = this.runner.clock.newId();
		const result = await this.run(treeId, { kind: 'create_note', noteId, note }, context);
		return { noteId, ...result };
	}

	updateSharedNote(
		treeId: string,
		noteId: string,
		note: SharedNoteInput,
		expectedVersion: number,
		context: AuthenticatedContext
	) {
		return this.run(treeId, { kind: 'update_shared_note', noteId, expectedVersion, note }, context);
	}

	deleteSharedNote(
		treeId: string,
		noteId: string,
		options: { expectedVersion?: number; shouldDetach?: boolean },
		context: AuthenticatedContext
	) {
		return this.run(treeId, { kind: 'delete_shared_note', noteId, ...options }, context);
	}

	mergeNotes(
		treeId: string,
		survivorId: string,
		mergedIds: string[],
		expectedVersions: Record<string, number> | undefined,
		context: AuthenticatedContext
	) {
		return this.run(
			treeId,
			{ kind: 'merge_notes', survivorId, mergedIds, expectedVersions },
			context
		);
	}
}
