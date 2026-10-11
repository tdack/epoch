import { describe, expect, it } from 'vitest';
import { ERROR_CODES, SetupError } from './errors.ts';
import { OWNERSHIPS } from './manifest.ts';
import {
	ADMITS,
	admitsEmail,
	assertEmail,
	describePolicy,
	editEmailRules,
	includesEveryone,
	isOfferable,
	ownedPolicyOf,
	policiesAdmit,
	type AccessPolicy
} from './policy.ts';
import { fixture, testManifest } from './testing.ts';

const [family, everyone, bypass] = (
	fixture('access-policies.json') as Omit<AccessPolicy, 'appNames'>[]
).map((p) => ({ ...p, appNames: [] as string[] }));

function policy(over: Partial<AccessPolicy>): AccessPolicy {
	return {
		id: 'p',
		name: 'p',
		decision: 'allow',
		include: [],
		exclude: [],
		require: [],
		appNames: [],
		...over
	};
}

describe('which policies are offered', () => {
	it('only Allow: Bypass would let a request through with no identity, Block admits nobody', () => {
		expect(isOfferable(family!)).toBe(true);
		expect(isOfferable(bypass!)).toBe(false);
		expect(isOfferable(policy({ decision: 'deny' }))).toBe(false);
	});

	it('flags a policy that includes everyone', () => {
		expect(includesEveryone(everyone!)).toBe(true);
		expect(includesEveryone(family!)).toBe(false);
	});

	it('describes the include rules and the apps using it', () => {
		expect(describePolicy({ ...family!, appNames: ['Photos', 'Wiki'] })).toBe(
			'Family: email a@example.com, email b@example.com. Used by: Photos, Wiki'
		);
		expect(describePolicy(family!)).toContain('Used by: (none)');
	});
});

describe('does the owner get in', () => {
	it('matches an email rule, case-insensitively', () => {
		expect(admitsEmail(family!, 'A@Example.com')).toBe(ADMITS.yes);
		expect(admitsEmail(family!, 'stranger@example.com')).toBe(ADMITS.no);
	});

	it('matches an email domain and everyone', () => {
		expect(
			admitsEmail(
				policy({ include: [{ email_domain: { domain: 'example.com' } }] }),
				'x@example.com'
			)
		).toBe(ADMITS.yes);
		expect(admitsEmail(everyone!, 'anyone@anywhere.org')).toBe(ADMITS.yes);
	});

	it('does not guess at a group or login-method rule', () => {
		expect(admitsEmail(policy({ include: [{ group: { id: 'g' } }] }), 'a@example.com')).toBe(
			ADMITS.unknown
		);
	});

	it('an exclude rule that matches wins, and a Block policy admits nobody', () => {
		expect(
			admitsEmail(
				policy({ include: [{ everyone: {} }], exclude: [{ email: { email: 'a@example.com' } }] }),
				'a@example.com'
			)
		).toBe(ADMITS.no);
		expect(admitsEmail(bypass!, 'a@example.com')).toBe(ADMITS.no);
	});

	it('a require rule the email fails keeps it out', () => {
		expect(
			admitsEmail(
				policy({
					include: [{ everyone: {} }],
					require: [{ email_domain: { domain: 'corp.com' } }]
				}),
				'a@example.com'
			)
		).toBe(ADMITS.no);
	});

	it('several policies: one yes is enough, otherwise unknown beats no', () => {
		expect(policiesAdmit([family!, everyone!], 'zed@example.org')).toBe(ADMITS.yes);
		expect(
			policiesAdmit([family!, policy({ include: [{ group: { id: 'g' } }] })], 'zed@example.org')
		).toBe(ADMITS.unknown);
		expect(policiesAdmit([family!], 'zed@example.org')).toBe(ADMITS.no);
	});
});

describe('allow and disallow', () => {
	it('refuse a policy the tool did not create', () => {
		const referenced = testManifest({
			access: {
				app: null,
				idps: [],
				policies: [{ id: 'p1', name: 'Family', ownership: OWNERSHIPS.referenced }]
			}
		});
		try {
			ownedPolicyOf(referenced);
			throw new Error('did not throw');
		} catch (error) {
			expect((error as SetupError).code).toBe(ERROR_CODES.usage);
			expect((error as SetupError).message).toContain('did not create');
		}
	});

	it('find the policy the tool owns', () => {
		const owned = testManifest({
			access: {
				app: null,
				idps: [],
				policies: [
					{ id: 'p1', name: 'Family', ownership: OWNERSHIPS.referenced },
					{ id: 'p2', name: 'Epoch epoch sign-in', ownership: OWNERSHIPS.owned }
				]
			}
		});
		expect(ownedPolicyOf(owned).id).toBe('p2');
	});

	it('add an address once and keep other rule types', () => {
		const include = [{ email_domain: { domain: 'example.com' } }];
		const added = editEmailRules(include, { action: 'add', email: 'New@Example.org' });
		expect(added).toEqual([...include, { email: { email: 'new@example.org' } }]);
		expect(editEmailRules(added, { action: 'add', email: 'new@example.org' })).toBe(added);
	});

	it('refuse to remove the last rule, because that would lock everyone out', () => {
		expect(() =>
			editEmailRules([{ email: { email: 'a@example.com' } }], {
				action: 'remove',
				email: 'a@example.com'
			})
		).toThrow('last rule');
		expect(
			editEmailRules(
				[{ email: { email: 'a@example.com' } }, { email: { email: 'b@example.com' } }],
				{ action: 'remove', email: 'a@example.com' }
			)
		).toEqual([{ email: { email: 'b@example.com' } }]);
	});

	it('validate the address before it goes near a request body', () => {
		expect(() => assertEmail('not an email')).toThrow('does not look like');
		expect(assertEmail('A@B.co')).toBe('a@b.co');
	});
});
