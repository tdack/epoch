export type ErrorCode =
	| 'UNAUTHENTICATED'
	| 'UNAUTHORIZED'
	| 'NOT_ADMITTED'
	| 'NOT_FOUND'
	| 'VALIDATION_ERROR'
	| 'CONCURRENCY_CONFLICT'
	| 'UNDO_REFUSED'
	| 'UNION_MERGE_CONFLICT'
	| 'PERSON_MERGE_CONFLICT'
	| 'SOURCE_IN_USE'
	| 'NOTE_IN_USE'
	| 'export_expired'
	| 'export_unavailable'
	| 'RATE_LIMITED'
	| 'LEAVE_BLOCKED'
	| 'INTERNAL_ERROR'
	| 'BAD_REQUEST';

export class DomainError extends Error {
	public readonly code: ErrorCode;
	public readonly status: number;
	public readonly details?: Record<string, unknown>;

	constructor(
		message: string,
		code: ErrorCode = 'BAD_REQUEST',
		status = 400,
		details?: Record<string, unknown>
	) {
		super(message);
		this.name = 'DomainError';
		this.code = code;
		this.status = status;
		this.details = details;
	}
}

export class UnauthenticatedError extends DomainError {
	constructor(message = 'Authentication required', details?: Record<string, unknown>) {
		super(message, 'UNAUTHENTICATED', 401, details);
		this.name = 'UnauthenticatedError';
	}
}

export class UnauthorizedError extends DomainError {
	constructor(message = 'Access denied', details?: Record<string, unknown>) {
		super(message, 'UNAUTHORIZED', 403, details);
		this.name = 'UnauthorizedError';
	}
}

/**
 * The caller is not admitted to this install: not its owner, and holding no membership (ADR-034).
 * Distinct from `UnauthorizedError`, which is about one tree, so a client can tell "ask for an
 * invitation" from "ask for a higher role".
 */
export class NotAdmittedError extends DomainError {
	constructor(message = 'Ask the owner of this Epoch for an invitation') {
		super(message, 'NOT_ADMITTED', 403);
		this.name = 'NotAdmittedError';
	}
}

export class NotFoundError extends DomainError {
	constructor(entity: string, id?: string, details?: Record<string, unknown>) {
		super(id ? `${entity} '${id}' not found` : `${entity} not found`, 'NOT_FOUND', 404, details);
		this.name = 'NotFoundError';
	}
}

export class ValidationError extends DomainError {
	constructor(message: string, details?: Record<string, unknown>) {
		super(message, 'VALIDATION_ERROR', 400, details);
		this.name = 'ValidationError';
	}
}

/** A request body was larger than the endpoint allows (HTTP 413). */
export class PayloadTooLargeError extends DomainError {
	constructor(message = 'Payload too large') {
		super(message, 'VALIDATION_ERROR', 413);
		this.name = 'PayloadTooLargeError';
	}
}

export class ConcurrencyConflictError extends DomainError {
	constructor(
		message = 'The record was modified by another collaborator. Please refresh and try again.',
		details?: Record<string, unknown>
	) {
		super(message, 'CONCURRENCY_CONFLICT', 409, details);
		this.name = 'ConcurrencyConflictError';
	}
}

/** Undo was refused; `details.reason` says why (see `UNDO_REFUSALS`), the message says it in words. */
export class UndoRefusedError extends DomainError {
	constructor(message: string, reason: string, status = 409) {
		super(message, 'UNDO_REFUSED', status, { reason });
		this.name = 'UndoRefusedError';
	}
}

/** Two people disagree on a field a merge cannot keep both of; `details.conflicts` lists every one. */
export class PersonMergeConflictError extends DomainError {
	constructor(message: string, conflicts: unknown[]) {
		super(message, 'PERSON_MERGE_CONFLICT', 409, { reason: 'MERGE_CONFLICT', conflicts });
		this.name = 'PersonMergeConflictError';
	}
}

/** A merge would have to pick between two different facts; `details.conflicts` lists every one. */
export class UnionMergeConflictError extends DomainError {
	constructor(message: string, conflicts: unknown[]) {
		super(message, 'UNION_MERGE_CONFLICT', 409, { reason: 'MERGE_CONFLICT', conflicts });
		this.name = 'UnionMergeConflictError';
	}
}

/** A source cannot be deleted while records cite it; `details.citationCount` says how many. */
export class SourceInUseError extends DomainError {
	constructor(message: string, citationCount: number) {
		super(message, 'SOURCE_IN_USE', 409, { reason: 'SOURCE_IN_USE', citationCount });
		this.name = 'SourceInUseError';
	}
}

/** A shared note cannot be deleted while records use it; `details.useCount` says how many. */
export class NoteInUseError extends DomainError {
	constructor(message: string, useCount: number) {
		super(message, 'NOTE_IN_USE', 409, { reason: 'NOTE_IN_USE', useCount });
		this.name = 'NoteInUseError';
	}
}

/**
 * A finished export has outlived its retention window (ADR-015/export): the object was removed and
 * the client must start a new export. The message is fixed and carries no id, so a caller cannot
 * learn whether a given instance ever existed.
 */
export class ExportExpiredError extends DomainError {
	constructor() {
		super('This export has expired. Start a new one.', 'export_expired', 410);
		this.name = 'ExportExpiredError';
	}
}

/**
 * An export's status or download could not be read: a missing binding, or a workflow call that
 * failed. A fixed message, so a raw runtime error never reaches the client.
 */
export class ExportUnavailableError extends DomainError {
	constructor() {
		super('The export service is temporarily unavailable', 'export_unavailable', 503);
		this.name = 'ExportUnavailableError';
	}
}

/**
 * A Cloudflare binding the endpoint needs is missing from this deployment. A 500 with a fixed
 * message: the binding's name says how the install is wired, which a client has no use for. `name`
 * goes to the log only.
 */
export class BindingUnavailableError extends DomainError {
	constructor(name: string) {
		super('The service is temporarily unavailable', 'INTERNAL_ERROR', 500);
		this.name = 'BindingUnavailableError';
		console.error(`Binding unavailable: ${name}`);
	}
}

/**
 * The caller has made too many requests to this endpoint for now (HTTP 429). `retryAfterSeconds`
 * becomes the `Retry-After` header in `errorResponse` and is repeated in `details` for the client.
 */
export class RateLimitedError extends DomainError {
	constructor(
		message: string,
		public readonly retryAfterSeconds: number
	) {
		super(message, 'RATE_LIMITED', 429, { retryAfterSeconds });
		this.name = 'RateLimitedError';
	}
}

/** Leaving is blocked until ownership moves; `details` is the `LeaveBlockersDto` so a client can say which trees. */
export class LeaveBlockedError extends DomainError {
	constructor(message: string, blockers: { isInstallOwner: boolean; soleOwnerTrees: unknown[] }) {
		super(message, 'LEAVE_BLOCKED', 409, { ...blockers });
		this.name = 'LeaveBlockedError';
	}
}
