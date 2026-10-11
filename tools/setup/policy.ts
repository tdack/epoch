import { ERROR_CODES, SetupError } from './errors.ts';
import type { Manifest } from './manifest.ts';

/** One Access rule as the API returns it: a single key naming the rule type. */
export type AccessRule = Record<string, unknown>;

export interface AccessPolicy {
	id: string;
	name: string;
	decision: string;
	include: AccessRule[];
	exclude: AccessRule[];
	require: AccessRule[];
	/** Names of the applications that use this reusable policy. Filled in by the caller. */
	appNames: string[];
}

export const ADMITS = { yes: 'yes', no: 'no', unknown: 'unknown' } as const;
export type Admits = (typeof ADMITS)[keyof typeof ADMITS];

function ruleType(rule: AccessRule): string {
	return Object.keys(rule)[0] ?? 'unknown';
}

function field(rule: AccessRule, outer: string, inner: string): string | null {
	const value = (rule[outer] as Record<string, unknown> | undefined)?.[inner];
	return typeof value === 'string' ? value.toLowerCase() : null;
}

/**
 * Only email, email domain and everyone can be judged without the identity provider. Anything
 * else (a group, a login method, an IP range) is `unknown` rather than guessed, so the tool
 * warns instead of claiming the owner can or cannot sign in.
 */
function ruleMatches(rule: AccessRule, email: string): Admits {
	const lower = email.toLowerCase();
	switch (ruleType(rule)) {
		case 'everyone':
			return ADMITS.yes;
		case 'email':
			return field(rule, 'email', 'email') === lower ? ADMITS.yes : ADMITS.no;
		case 'email_domain':
			return field(rule, 'email_domain', 'domain') === lower.split('@')[1] ? ADMITS.yes : ADMITS.no;
		case 'any_valid_service_token':
		case 'certificate':
			return ADMITS.no;
		default:
			return ADMITS.unknown;
	}
}

export function admitsEmail(policy: AccessPolicy, email: string): Admits {
	if (policy.decision !== 'allow') return ADMITS.no;
	if (policy.exclude.some((rule) => ruleMatches(rule, email) === ADMITS.yes)) return ADMITS.no;
	const isExcludeUncertain = policy.exclude.some(
		(rule) => ruleMatches(rule, email) === ADMITS.unknown
	);
	const requires = policy.require.map((rule) => ruleMatches(rule, email));
	if (requires.includes(ADMITS.no)) return ADMITS.no;
	const includes = policy.include.map((rule) => ruleMatches(rule, email));
	let includeResult: Admits = ADMITS.no;
	if (includes.includes(ADMITS.yes)) includeResult = ADMITS.yes;
	else if (includes.includes(ADMITS.unknown)) includeResult = ADMITS.unknown;
	if (includeResult === ADMITS.no) return ADMITS.no;
	if (isExcludeUncertain || requires.includes(ADMITS.unknown)) return ADMITS.unknown;
	return includeResult;
}

/** Admitted by at least one of the chosen policies (Access ORs the policies on an application). */
export function policiesAdmit(policies: AccessPolicy[], email: string): Admits {
	const results = policies.map((policy) => admitsEmail(policy, email));
	if (results.includes(ADMITS.yes)) return ADMITS.yes;
	if (results.includes(ADMITS.unknown)) return ADMITS.unknown;
	return ADMITS.no;
}

/** Bypass would let a request through with no identity for the Worker to validate; Block admits nobody. */
export function isOfferable(policy: AccessPolicy): boolean {
	return policy.decision === 'allow';
}

export function includesEveryone(policy: AccessPolicy): boolean {
	return policy.include.some((rule) => ruleType(rule) === 'everyone');
}

function describeRule(rule: AccessRule): string {
	const type = ruleType(rule);
	switch (type) {
		case 'email':
			return `email ${field(rule, 'email', 'email') ?? '?'}`;
		case 'email_domain':
			return `email domain ${field(rule, 'email_domain', 'domain') ?? '?'}`;
		case 'everyone':
			return 'everyone';
		case 'group':
			return 'an Access group';
		default:
			return type.replaceAll('_', ' ');
	}
}

export function describePolicy(policy: AccessPolicy): string {
	const rules = policy.include.map(describeRule);
	const shown = rules.length > 3 ? [...rules.slice(0, 3), `${rules.length - 3} more`] : rules;
	const used = policy.appNames.length > 0 ? policy.appNames.join(', ') : '(none)';
	return `${policy.name}: ${shown.join(', ') || 'no include rules'}. Used by: ${used}`;
}

export interface PolicyChoice {
	/** Existing policy ids to attach, in precedence order. They are never edited. */
	existingIds: string[];
	/** Create `Epoch <name> sign-in` with the owner's email only. */
	isNewPolicy: boolean;
}

export function ownerOnlyRules(ownerEmail: string): AccessRule[] {
	return [{ email: { email: ownerEmail.toLowerCase() } }];
}

/** The tool may edit only a policy it created: its id is in the manifest as `owned`. */
export function ownedPolicyOf(manifest: Manifest): { id: string; name: string } {
	const owned = manifest.access.policies.find((ref) => ref.ownership === 'owned');
	if (!owned) {
		throw new SetupError(
			ERROR_CODES.usage,
			'This install uses Access policies that setup did not create, so it will not edit them',
			{
				hint: 'Change who may sign in from the Cloudflare dashboard (Zero Trust → Access → Policies).'
			}
		);
	}
	return owned;
}

const EMAIL_PATTERN = /^[^\s@,;'"<>]+@[^\s@,;'"<>]+\.[^\s@,;'"<>]+$/;

export function assertEmail(email: string): string {
	if (!EMAIL_PATTERN.test(email)) {
		throw new SetupError(ERROR_CODES.usage, `"${email}" does not look like an email address`);
	}
	return email.toLowerCase();
}

/** Include rules after adding or removing one address; other rule types are kept as they are. */
export function editEmailRules(
	include: AccessRule[],
	change: { action: 'add' | 'remove'; email: string }
): AccessRule[] {
	const email = change.email.toLowerCase();
	const isThatEmail = (rule: AccessRule) =>
		ruleType(rule) === 'email' && field(rule, 'email', 'email') === email;
	if (change.action === 'add') {
		return include.some(isThatEmail) ? include : [...include, { email: { email } }];
	}
	const rest = include.filter((rule) => !isThatEmail(rule));
	if (rest.length === 0) {
		throw new SetupError(
			ERROR_CODES.usage,
			`${email} is the last rule in the policy; removing it would let nobody in`,
			{
				hint: 'Allow another address first.'
			}
		);
	}
	return rest;
}
