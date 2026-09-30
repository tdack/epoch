/**
 * Name types and the one formatter for how a person is shown (Phase 3, S6).
 *
 * Browser-safe: the server's labels, the graph, the person page and the editor's type picker all
 * read it, so a card and a preview cannot disagree about "Jessica Wren (née Lovejoy)".
 */

import { personName } from './person-name';

export const NAME_TYPES = {
	BIRTH: 'birth',
	MARRIED: 'married',
	AKA: 'aka',
	IMMIGRANT: 'immigrant',
	MAIDEN: 'maiden',
	PROFESSIONAL: 'professional',
	OTHER: 'other'
} as const;
export type NameType = (typeof NAME_TYPES)[keyof typeof NAME_TYPES];

export const NAME_TYPE_LABELS: Record<NameType, string> = {
	birth: 'Birth name',
	married: 'Married name',
	aka: 'Also known as',
	immigrant: 'Immigrant name',
	maiden: 'Maiden name',
	professional: 'Professional name',
	other: 'Other name'
};

export const NAME_TYPE_LIST: readonly NameType[] = Object.values(NAME_TYPES);

export function isNameType(value: unknown): value is NameType {
	return typeof value === 'string' && (NAME_TYPE_LIST as readonly string[]).includes(value);
}

/** What the name editor submits. `undefined` on an update leaves a field as it is. */
export interface NameInput {
	type: NameType;
	givenName?: string | null;
	surname?: string | null;
	prefix?: string | null;
	suffix?: string | null;
	nickname?: string | null;
	surnamePrefix?: string | null;
	/** Original text of the optional "in use from" date; parsed by `dateColumnsFor`. */
	dateText?: string | null;
	/** The partnership the name came from (a marriage, usually). */
	unionId?: string | null;
}

interface NameParts {
	prefix?: string | null;
	givenName?: string | null;
	surnamePrefix?: string | null;
	surname?: string | null;
	suffix?: string | null;
}

/** The whole name written out: "Dr Julius Hibbert Jr". */
export function formatFullName(name: NameParts): string {
	return [name.prefix, name.givenName, name.surnamePrefix, name.surname, name.suffix].filter(Boolean).join(' ') || 'Unknown';
}

const sameSurname = (a: string | null | undefined, b: string | null | undefined) =>
	(a ?? '').trim().toLocaleLowerCase() === (b ?? '').trim().toLocaleLowerCase();

/** The name someone was born with, when it differs from the one they go by: a maiden name first, else a birth name. */
export function birthSurnameOf(
	preferredSurname: string | null | undefined,
	names: ReadonlyArray<{ type: string; surname: string | null; isPreferred?: boolean }>
): string | null {
	const candidates = (type: NameType) => names.filter((n) => n.type === type && !n.isPreferred && n.surname?.trim() && !sameSurname(n.surname, preferredSurname));
	return (candidates('maiden')[0] ?? candidates('birth')[0])?.surname?.trim() ?? null;
}

/**
 * "Jessica Wren (née Lovejoy)": the preferred name, and the birth surname when the person has a
 * birth or maiden name that differs. With no stored names it is exactly `personName`.
 */
export function displayNameWith(
	person: { givenName: string | null; surname: string | null } | undefined,
	names: ReadonlyArray<{ type: string; surname: string | null; isPreferred?: boolean }> = []
): string {
	const base = personName(person);
	if (!person) return base;
	const birth = birthSurnameOf(person.surname, names);
	return birth ? `${base} (née ${birth})` : base;
}

const BIRTH_SUFFIX = /^(.*) \(née (.+)\)$/;

/**
 * The inverse of `displayNameWith`, for the views that draw the two halves apart (a card puts
 * "née Simpson" on its own line). It lives beside the formatter so the format is written once.
 */
export function splitDisplayName(displayName: string): { name: string; birthSurname: string | null } {
	const match = BIRTH_SUFFIX.exec(displayName);
	return match ? { name: match[1]!, birthSurname: match[2]! } : { name: displayName, birthSurname: null };
}
