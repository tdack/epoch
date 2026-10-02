export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'CONCURRENCY_CONFLICT'
  | 'UNDO_REFUSED'
  | 'UNION_MERGE_CONFLICT'
  | 'PERSON_MERGE_CONFLICT'
  | 'INTERNAL_ERROR'
  | 'BAD_REQUEST';

export class DomainError extends Error {
  public readonly code: ErrorCode;
  public readonly status: number;
  public readonly details?: Record<string, unknown>;

  constructor(message: string, code: ErrorCode = 'BAD_REQUEST', status = 400, details?: Record<string, unknown>) {
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

export class ConcurrencyConflictError extends DomainError {
  constructor(message = 'The record was modified by another collaborator. Please refresh and try again.', details?: Record<string, unknown>) {
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
