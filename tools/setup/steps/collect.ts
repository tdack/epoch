import type { Asker, Choice } from '../asker.ts';
import { resolveAnswer, type AnswerMode } from '../answers.ts';
import type { AccountInfo, Identity, IdpInfo, ZoneInfo } from '../cloudflare.ts';
import type { StepContext } from '../context.ts';
import { ERROR_CODES, SetupError } from '../errors.ts';
import { NO_DEFAULTS, type DeployDefaults } from '../deploy-config.ts';
import { withStepDone, type Manifest } from '../manifest.ts';
import { HOSTINGS, type Answers, type Hosting, type SetupFlags } from '../options.ts';
import {
	ADMITS,
	assertEmail,
	describePolicy,
	includesEveryone,
	isOfferable,
	policiesAdmit,
	type AccessPolicy,
	type PolicyChoice
} from '../policy.ts';
import { resourceNames } from '../names.ts';

export interface Discovery {
	accounts: AccountInfo[];
	zones: ZoneInfo[];
	idps: IdpInfo[];
	policies: AccessPolicy[];
	teamDomain: string;
}

const NEW_POLICY = '__new__';
const LOCATION_CHOICES: Choice<string | null>[] = [
	{ value: null, label: 'Closest to the first request (recommended unless you care)' },
	{ value: 'oc', label: 'Oceania', hint: 'Australia' },
	{ value: 'apac', label: 'Asia-Pacific' },
	{ value: 'weur', label: 'Western Europe' },
	{ value: 'eeur', label: 'Eastern Europe' },
	{ value: 'wnam', label: 'Western North America' },
	{ value: 'enam', label: 'Eastern North America' }
];
const JURISDICTION_CHOICES: Choice<string | null>[] = [
	{ value: null, label: 'None', hint: 'There is no Australian jurisdiction' },
	{ value: 'eu', label: 'European Union' },
	{ value: 'fedramp', label: 'FedRAMP' }
];

function prerequisite(message: string, hint: string): SetupError {
	return new SetupError(ERROR_CODES.prerequisite, message, { hint });
}

/** A flag value matches by id or by name, so `--zone example.com` and `--zone <id>` both work. */
function pick<T extends { id: string; name: string }>(
	items: T[],
	wanted: string | undefined,
	flag: string
): T | undefined {
	if (wanted === undefined) return undefined;
	const found = items.find((item) => item.id === wanted || item.name === wanted);
	if (!found) {
		throw new SetupError(
			ERROR_CODES.usage,
			`${flag} "${wanted}" is not one of: ${items.map((i) => i.name).join(', ')}`,
			{ flag }
		);
	}
	return found;
}

async function chooseOne<T extends { id: string; name: string }>(
	items: T[],
	flagValue: string | undefined,
	flag: string,
	message: string,
	mode: AnswerMode,
	asker: Asker
): Promise<T> {
	const resolution = resolveAnswer(
		{
			flag,
			flagValue: pick(items, flagValue, flag),
			onlyChoice: items.length === 1 ? items[0] : undefined
		},
		mode
	);
	if (resolution.status === 'answered') return resolution.value;
	return asker.select({
		message,
		choices: items.map((item) => ({ value: item, label: item.name, hint: item.id }))
	});
}

/**
 * Discover first, ask second (plan step 3). Everything is asked here, before anything is created,
 * so the later steps are plain functions of the manifest and these answers.
 */
export async function collect(
	ctx: StepContext,
	manifest: Manifest,
	flags: SetupFlags,
	identity: Identity,
	mode: AnswerMode,
	asker: Asker,
	defaults: DeployDefaults = NO_DEFAULTS
): Promise<{ manifest: Manifest; answers: Answers; discovery: Discovery }> {
	const names = resourceNames(manifest.workerName);

	const accounts = await ctx.cf.listAccounts();
	if (accounts.length === 0) {
		throw prerequisite(
			'This sign-in can see no Cloudflare account',
			'Sign in with the account that owns your domain.'
		);
	}
	const account = await chooseOne(
		accounts,
		flags.account,
		'--account',
		'Which Cloudflare account?',
		mode,
		asker
	);
	ctx.cf.useAccount(account.id);

	const subdomain = await ctx.cf.getWorkersSubdomain();
	const zones = await ctx.cf.listActiveZones();
	const offered: Hosting[] = [
		...(subdomain ? [HOSTINGS.workersDev] : []),
		...(zones.length > 0 ? [HOSTINGS.custom] : [])
	];
	if (offered.length === 0) {
		throw prerequisite(
			'This account has no workers.dev subdomain and no active domain, so there is nowhere to serve Epoch',
			'Set a workers.dev subdomain (Workers & Pages) or add and activate a domain first; setup creates neither.'
		);
	}
	if (flags.hosting !== undefined && !offered.includes(flags.hosting)) {
		throw new SetupError(
			ERROR_CODES.usage,
			`--hosting ${flags.hosting} is not possible here (${flags.hosting === HOSTINGS.workersDev ? 'no workers.dev subdomain is set' : 'no active domain'})`,
			{ flag: '--hosting' }
		);
	}
	const hostingResolution = resolveAnswer<Hosting>(
		{
			flag: '--hosting',
			flagValue: flags.hosting,
			onlyChoice: offered.length === 1 ? offered[0] : undefined,
			defaultValue:
				defaults.hosting && offered.includes(defaults.hosting)
					? defaults.hosting
					: offered.includes(HOSTINGS.custom)
						? HOSTINGS.custom
						: HOSTINGS.workersDev
		},
		mode
	);
	const hosting =
		hostingResolution.status === 'answered'
			? hostingResolution.value
			: await asker.select<Hosting>({
					message: 'Where should Epoch be served?',
					choices: offered.map((value) => ({
						value,
						label:
							value === HOSTINGS.workersDev
								? `workers.dev only (${manifest.workerName}.${subdomain}.workers.dev)`
								: 'A custom domain'
					}))
				});

	let zone: ZoneInfo | null = null;
	let isWorkersDevKept = false;
	if (hosting === HOSTINGS.custom) {
		zone = await chooseOne(
			zones,
			flags.zone,
			'--zone',
			'Which domain should Epoch live on?',
			mode,
			asker
		);
		const keepResolution = resolveAnswer<boolean>(
			{
				flag: '--keep-workers-dev',
				flagValue: flags.isKeepWorkersDev,
				defaultValue: defaults.isWorkersDevKept ?? false
			},
			mode
		);
		isWorkersDevKept =
			keepResolution.status === 'answered'
				? keepResolution.value
				: await asker.confirm({
						message: 'Keep the workers.dev URL on as well?',
						isInitiallyYes: false
					});
		if (isWorkersDevKept && !subdomain) {
			throw prerequisite(
				'There is no workers.dev subdomain to keep on',
				'Drop --keep-workers-dev, or set a subdomain first.'
			);
		}
	}

	const teamDomain = await ctx.cf.getTeamDomain();
	if (!teamDomain) {
		throw prerequisite(
			'This account has no Zero Trust organisation',
			'Set up Zero Trust in the Cloudflare dashboard (Zero Trust → Settings), then re-run. Setup never creates it.'
		);
	}
	const idps = await ctx.cf.listIdentityProviders();
	if (idps.length === 0) {
		throw prerequisite(
			'Zero Trust has no identity provider',
			'Add one (for example One-time PIN) under Zero Trust → Settings → Authentication, then re-run.'
		);
	}

	const ownerResolution = resolveAnswer(
		{
			flag: '--owner-email',
			flagValue: flags.ownerEmail,
			defaultValue: identity.email ?? undefined
		},
		mode
	);
	const ownerEmail = assertEmail(
		ownerResolution.status === 'answered'
			? ownerResolution.value
			: await asker.text({
					message: 'Owner email (the address you will sign in with)',
					initial: identity.email ?? '',
					validate: (v) => {
						try {
							assertEmail(v);
							return undefined;
						} catch {
							return 'Enter an email address';
						}
					}
				})
	);

	const idpResolution = resolveAnswer<string[]>(
		{
			flag: '--idp',
			flagValue: flags.idp,
			onlyChoice: idps.length === 1 ? [idps[0]!.id] : undefined,
			defaultValue: idps.map((idp) => idp.id)
		},
		mode
	);
	const idpIds =
		idpResolution.status === 'answered'
			? idpResolution.value
			: await asker.multiselect({
					message: 'Which sign-in methods should Epoch offer?',
					choices: idps.map((idp) => ({ value: idp.id, label: idp.name, hint: idp.type })),
					initial: idps.map((idp) => idp.id),
					isRequired: true
				});
	for (const id of idpIds) {
		if (!idps.some((idp) => idp.id === id)) {
			throw new SetupError(
				ERROR_CODES.usage,
				`--idp "${id}" is not an identity provider in this account`,
				{ flag: '--idp' }
			);
		}
	}

	let hostname: string;
	if (hosting === HOSTINGS.workersDev) {
		// The host is fixed by the Worker name and the account's subdomain; there is nothing to ask or to collide with.
		hostname = `${manifest.workerName}.${subdomain}.workers.dev`;
	} else if (zone) {
		const onZone = (v: string) => v === zone.name || v.endsWith(`.${zone.name}`);
		const defaultHost =
			defaults.hostname && onZone(defaults.hostname)
				? defaults.hostname
				: `${manifest.workerName}.${zone.name}`;
		const hostResolution = resolveAnswer(
			{ flag: '--hostname', flagValue: flags.hostname, defaultValue: defaultHost },
			mode
		);
		hostname = (
			hostResolution.status === 'answered'
				? hostResolution.value
				: await asker.text({
						message: 'Hostname',
						initial: defaultHost,
						validate: (v) => (onZone(v) ? undefined : `Must be ${zone.name} or a subdomain of it`)
					})
		).toLowerCase();
		if (!onZone(hostname)) {
			throw new SetupError(ERROR_CODES.usage, `${hostname} is not on ${zone.name}`, {
				flag: '--hostname'
			});
		}
		// Already ours (it is in the manifest, or the Worker serves it): not a clash.
		if (manifest.hostname !== hostname) {
			const clash = await ctx.cf.findHostnameUse(zone.id, hostname, names.worker);
			if (clash)
				throw prerequisite(
					`Cannot use ${hostname}: ${clash}`,
					'Choose another hostname with --hostname.'
				);
		}
	} else {
		throw new Error('unreachable: custom hosting without a zone');
	}

	const policies = await listPoliciesWithApps(ctx);
	// An application already on this host's /login keeps its policies as the default, so adopting an existing install changes nothing.
	const existingApp = (await ctx.cf.listAccessApps()).find(
		(app) => app.domain === `${hostname}/login`
	);
	const policy = await choosePolicy(
		ctx,
		names.accessPolicy,
		existingApp?.policyIds ?? [],
		policies,
		flags,
		ownerEmail,
		mode,
		asker
	);

	const d1Location = await optional(
		flags.d1Location,
		'--d1-location',
		'D1 data location (cannot be changed later)',
		LOCATION_CHOICES,
		mode,
		asker
	);
	const r2Location = await optional(
		flags.r2Location,
		'--r2-location',
		'R2 data location (cannot be changed later)',
		LOCATION_CHOICES,
		mode,
		asker
	);
	const r2Jurisdiction = await optional(
		flags.r2Jurisdiction,
		'--r2-jurisdiction',
		'R2 jurisdiction (cannot be changed later)',
		JURISDICTION_CHOICES,
		mode,
		asker
	);

	const emailSender = zone ? await chooseSender(ctx, zone, flags, mode, asker) : null;

	const answers: Answers = {
		workerName: manifest.workerName,
		account,
		hosting,
		zone,
		hostname,
		isWorkersDevKept,
		ownerEmail,
		idpIds,
		policy,
		d1Location,
		r2Location,
		r2Jurisdiction,
		emailSender,
		typedAdoptions: {}
	};
	const next = ctx.save(
		withStepDone(
			{
				...manifest,
				account,
				zone,
				hosting,
				isWorkersDevKept,
				hostname,
				ownerEmail,
				teamDomain,
				emailSender,
				locations: { d1Hint: d1Location, r2Hint: r2Location, r2Jurisdiction }
			},
			'collect'
		)
	);
	return { manifest: next, answers, discovery: { accounts, zones, idps, policies, teamDomain } };
}

/** Data location is offered, not required: `--yes` and flags leave it unset, a terminal asks. */
async function optional(
	flagValue: string | undefined,
	flag: string,
	message: string,
	choices: Choice<string | null>[],
	mode: AnswerMode,
	asker: Asker
): Promise<string | null> {
	if (flagValue !== undefined) return flagValue;
	if (mode.isYes || !mode.isInteractive) return null;
	return asker.select({ message, choices });
}

export async function listPoliciesWithApps(ctx: StepContext): Promise<AccessPolicy[]> {
	const [policies, apps] = await Promise.all([ctx.cf.listPolicies(), ctx.cf.listAccessApps()]);
	return policies.map((policy) => ({
		...policy,
		appNames: apps.filter((app) => app.policyIds.includes(policy.id)).map((app) => app.name)
	}));
}

/**
 * What setup does without being asked: keep the policies already on the application it is adopting,
 * otherwise make its own. Never another application's policy, however well it happens to match the
 * owner: a pre-ticked unrelated policy was once submitted by an Enter meant for another row.
 */
function defaultChoice(policies: AccessPolicy[], currentIds: string[]): PolicyChoice {
	const kept = policies.filter((p) => currentIds.includes(p.id) && isOfferable(p));
	return kept.length > 0
		? { existingIds: kept.map((p) => p.id), isNewPolicy: false }
		: { existingIds: [], isNewPolicy: true };
}

async function choosePolicy(
	ctx: StepContext,
	newPolicyName: string,
	preferredIds: string[],
	policies: AccessPolicy[],
	flags: SetupFlags,
	ownerEmail: string,
	mode: AnswerMode,
	asker: Asker
): Promise<PolicyChoice> {
	const offerable = policies.filter(isOfferable);
	if (flags.isNewPolicy && flags.policy && flags.policy.length > 0) {
		throw new SetupError(ERROR_CODES.usage, '--policy and --new-policy cannot be combined', {
			flag: '--policy'
		});
	}
	let choice: PolicyChoice;
	if (flags.isNewPolicy) {
		choice = { existingIds: [], isNewPolicy: true };
	} else if (flags.policy && flags.policy.length > 0) {
		for (const id of flags.policy) {
			if (!offerable.some((p) => p.id === id)) {
				throw new SetupError(
					ERROR_CODES.usage,
					`--policy "${id}" is not an Allow policy in this account (Block and Bypass policies are not offered)`,
					{ flag: '--policy' }
				);
			}
		}
		choice = { existingIds: flags.policy, isNewPolicy: false };
	} else {
		const resolution = resolveAnswer<PolicyChoice>(
			{
				flag: '--policy or --new-policy',
				flagValue: undefined,
				defaultValue: defaultChoice(policies, preferredIds)
			},
			mode
		);
		if (resolution.status === 'answered') {
			choice = resolution.value;
		} else {
			const picked = await asker.multiselect<string>({
				message:
					'Which Access policy decides who can sign in? Space to tick one or more, Enter to confirm. Existing ones are attached as they are and never edited.',
				choices: [
					...offerable.map((policy) => ({
						value: policy.id,
						label: `${describePolicy(policy)}${preferredIds.includes(policy.id) ? ' (current)' : ''}`
					})),
					{
						value: NEW_POLICY,
						label: `Create a new policy "${newPolicyName}" (Allow: your email only)`
					}
				],
				// Only the adopted application's own policies start ticked; otherwise nothing is.
				initial: defaultChoice(policies, preferredIds).existingIds,
				isRequired: true
			});
			choice = {
				existingIds: picked.filter((id) => id !== NEW_POLICY),
				isNewPolicy: picked.includes(NEW_POLICY)
			};
		}
	}

	const chosen = offerable.filter((policy) => choice.existingIds.includes(policy.id));
	for (const policy of chosen) {
		if (includesEveryone(policy)) {
			ctx.report.warn(
				`"${policy.name}" admits everyone; any stranger the identity provider verifies can reach Epoch's sign-in. ADR-034 keeps them out of your trees, but you may prefer a narrower policy.`
			);
		}
	}
	if (!choice.isNewPolicy) {
		const admits = policiesAdmit(chosen, ownerEmail);
		if (admits === ADMITS.no) {
			throw new SetupError(
				ERROR_CODES.prerequisite,
				`The chosen policies do not admit ${ownerEmail}, so you could not sign in afterwards`,
				{
					hint: 'Pick a policy that includes your address, or pass --new-policy.'
				}
			);
		}
		if (admits === ADMITS.unknown) {
			ctx.report.warn(
				`Cannot confirm from the rules that ${ownerEmail} is admitted (a group or identity-provider rule); check after setup.`
			);
		}
	}
	return choice;
}

async function chooseSender(
	ctx: StepContext,
	zone: ZoneInfo,
	flags: SetupFlags,
	mode: AnswerMode,
	asker: Asker
): Promise<string | null> {
	if (flags.emailSender !== undefined) return flags.emailSender;
	if (mode.isYes || !mode.isInteractive) return null;
	const domains = await ctx.cf.listEmailSenderDomains(zone.id).catch(() => null);
	if (domains === null) {
		ctx.report.warn(
			'Could not read Email Sending status; the generated config will leave out send_email. Re-run setup after the domain is verified.'
		);
		return null;
	}
	const verified = domains.filter((d) => d.isVerified);
	if (verified.length === 0) return null;
	return asker.select<string | null>({
		message: 'Send invitations by email?',
		choices: [
			{ value: null, label: 'No, share invitation links myself' },
			...verified.map((d) => ({
				value: `welcome@${d.domain}`,
				label: `Yes, from welcome@${d.domain}`
			}))
		]
	});
}
