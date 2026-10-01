/**
 * Privacy placeholder carried by every record DTO. Phase 4 owns the policy (living people,
 * per-record restrictions, relationship privacy); until it lands, nothing is private, and this is
 * the one place that says so. DTOs spread {@link privacyOf} instead of writing `isPrivate: false`,
 * so the day the policy exists it changes here and every DTO already carries the answer.
 */

export interface PrivacyFlag {
	/** True when the viewer may not see the record's details. Always false until Phase 4. */
	isPrivate: boolean;
}

export function privacyOf(_record?: unknown): PrivacyFlag {
	return { isPrivate: false };
}

/** What an owner or manager can set on a person (ADR-015); `auto` follows the derived living state. */
export const PERSON_PRIVACY_VALUES = ['auto', 'public', 'private'] as const;
export type PersonPrivacy = (typeof PERSON_PRIVACY_VALUES)[number];
