import { Command, Option } from 'commander';
import { changeAllowedEmail } from './allow.ts';
import { createContext } from './app.ts';
import { runDoctor } from './doctor.ts';
import { CommandError, ERROR_CODES, SetupError } from './errors.ts';
import { resumeNote, runSetup } from './flow.ts';
import { readManifest } from './manifest.ts';
import { DEFAULT_FLAGS, DEPLOY_AUTHS, HOSTINGS, type SetupFlags } from './options.ts';
import { installPaths } from './paths.ts';
import { runSpike } from './spike.ts';
import { runTeardown } from './teardown.ts';
import { createUi } from './ui.ts';

/** What commander parses for the setup flags. `--no-browser` and `--no-device` arrive as `browser: false`. */
/* eslint-disable @typescript-eslint/naming-convention -- commander names these after the flags (`--yes`, `--no-browser`), so they cannot carry a boolean prefix */
interface RawOptions {
	yes?: boolean;
	json?: boolean;
	verbose?: boolean;
	plan?: boolean;
	force?: boolean;
	account?: string;
	zone?: string;
	hosting?: SetupFlags['hosting'];
	keepWorkersDev?: boolean;
	hostname?: string;
	policy?: string[];
	newPolicy?: boolean;
	idp?: string[];
	d1Location?: string;
	r2Location?: string;
	r2Jurisdiction?: string;
	emailSender?: string | false;
	ownerEmail?: string;
	deployAuth?: SetupFlags['deployAuth'];
	apiTokenEnv?: boolean;
	browser?: boolean;
	device?: boolean;
	name?: string;
}
/* eslint-enable @typescript-eslint/naming-convention */

export function toFlags(raw: RawOptions): SetupFlags {
	return {
		isYes: raw.yes ?? DEFAULT_FLAGS.isYes,
		isJson: raw.json ?? DEFAULT_FLAGS.isJson,
		isVerbose: raw.verbose ?? DEFAULT_FLAGS.isVerbose,
		isPlanOnly: raw.plan ?? DEFAULT_FLAGS.isPlanOnly,
		isForce: raw.force ?? DEFAULT_FLAGS.isForce,
		account: raw.account,
		zone: raw.zone,
		hosting: raw.hosting,
		isKeepWorkersDev: raw.keepWorkersDev,
		hostname: raw.hostname,
		policy: raw.policy,
		isNewPolicy: raw.newPolicy ?? DEFAULT_FLAGS.isNewPolicy,
		idp: raw.idp,
		d1Location: raw.d1Location,
		r2Location: raw.r2Location,
		r2Jurisdiction: raw.r2Jurisdiction,
		emailSender: typeof raw.emailSender === 'string' ? raw.emailSender : undefined,
		isEmailSenderRemoved: raw.emailSender === false ? true : undefined,
		ownerEmail: raw.ownerEmail,
		deployAuth: raw.deployAuth ?? DEFAULT_FLAGS.deployAuth,
		isApiTokenEnv: raw.apiTokenEnv ?? DEFAULT_FLAGS.isApiTokenEnv,
		isBrowser: raw.browser ?? DEFAULT_FLAGS.isBrowser,
		isDevice: raw.device ?? DEFAULT_FLAGS.isDevice,
		name: raw.name
	};
}

/** No TTY, or `--json` (stdout is the result): never prompt. */
function modeOf(flags: SetupFlags) {
	return {
		isYes: flags.isYes,
		isInteractive: Boolean(process.stdin.isTTY && process.stdout.isTTY) && !flags.isJson
	};
}

function addSetupOptions(command: Command): Command {
	return command
		.option('-y, --yes', 'accept every discovered default; still refuses typed confirmations')
		.option('--json', 'print one JSON result on stdout; progress goes to stderr')
		.option('--verbose', 'stream the cf and wrangler output instead of logging it')
		.option('--plan', 'reconcile and print the plan, then stop; changes nothing')
		.option('--force', 'sign in again even if a valid sign-in exists')
		.option('--account <id>', 'Cloudflare account id or name')
		.addOption(
			new Option('--hosting <where>', 'serve on workers.dev only, or on a custom domain').choices(
				Object.values(HOSTINGS)
			)
		)
		.option(
			'--keep-workers-dev',
			'custom domain: keep the workers.dev URL on as well (default off)'
		)
		.option('--zone <id>', 'zone (domain) id or name; custom domain only')
		.option('--hostname <host>', 'hostname for Epoch, on that zone')
		.option('--policy <ids...>', 'existing Allow policy ids to attach; they are never edited')
		.option('--new-policy', 'create "Epoch <name> sign-in" (Allow: your email only) instead')
		.option('--idp <ids...>', 'identity provider ids the sign-in offers')
		.option(
			'--d1-location <hint>',
			'D1 location hint (oc, apac, weur, eeur, wnam, enam); cannot be changed later'
		)
		.option('--r2-location <hint>', 'R2 location hint; cannot be changed later')
		.option('--r2-jurisdiction <name>', 'R2 jurisdiction (eu or fedramp); cannot be changed later')
		.option(
			'--email-sender <address>',
			'invitation sender on a verified Email Sending domain; omit to keep the current one'
		)
		.option('--no-email-sender', 'remove the send_email binding, even if one exists')
		.option('--owner-email <address>', 'owner address, if not the signed-in one')
		.addOption(
			new Option(
				'--deploy-auth <mode>',
				'wrangler profile (two consents); "ephemeral" is not available yet'
			)
				.choices(Object.values(DEPLOY_AUTHS))
				.default(DEPLOY_AUTHS.wrangler)
		)
		.option('--api-token-env', 'use CLOUDFLARE_API_TOKEN for everything instead of signing in')
		.option('--no-browser', 'print the sign-in link instead of opening it (SSH)')
		.option('--no-device', 'sign in with a localhost callback instead of a device code')
		.option(
			'--name <name>',
			'the Worker name; every resource and profile is named from it (default: epoch)'
		);
}

/** Runs `work`, printing a one-line reason and exiting non-zero on a SetupError. */
async function guarded(
	flags: { isJson: boolean },
	work: (ui: ReturnType<typeof createUi>) => Promise<unknown>
): Promise<void> {
	const ui = createUi({ isJson: flags.isJson });
	try {
		const result = await work(ui);
		if (flags.isJson && result !== undefined)
			process.stdout.write(`${JSON.stringify({ ok: true, ...(result as object) }, null, 2)}\n`);
	} catch (error) {
		const manifest = readManifest(installPaths().manifestFile);
		if (error instanceof SetupError) {
			if (error.code === ERROR_CODES.cancelled) {
				ui.outro(manifest ? resumeNote(manifest) : 'Nothing was changed.');
			} else {
				ui.error(error.message, error.hint);
				if (manifest && !(error instanceof CommandError && manifest.completedSteps.length === 0))
					ui.outro(resumeNote(manifest));
			}
			if (flags.isJson)
				process.stdout.write(
					`${JSON.stringify({ ok: false, error: { code: error.code, message: error.message, flag: error.flag } })}\n`
				);
			process.exitCode = error.code === ERROR_CODES.cancelled ? 130 : 1;
			return;
		}
		throw error;
	}
}

/** What each command does. Injectable so a test can check which one runs, and with which flags. */
export interface Handlers {
	setup(raw: RawOptions): Promise<void>;
	doctor(raw: RawOptions): Promise<void>;
	allow(action: 'add' | 'remove', email: string, raw: RawOptions): Promise<void>;
	teardown(raw: RawOptions): Promise<void>;
	spike(raw: RawOptions): Promise<void>;
}

function readOnlyContext(ui: ReturnType<typeof createUi>, flags: SetupFlags) {
	return createContext({ reporter: ui.reporter, isVerbose: flags.isVerbose, isReadOnly: true });
}

const DEFAULT_HANDLERS: Handlers = {
	setup: runDefault,
	async doctor(raw) {
		const flags = toFlags(raw);
		await guarded(flags, async (ui) => {
			const ctx = readOnlyContext(ui, flags);
			ui.intro('Epoch doctor');
			const { findings } = await ui.presenter.task('Checking the install', () => runDoctor(ctx));
			const hasFailure = findings.some((f) => f.level === 'fail');
			ui.showFindings(findings);
			if (hasFailure) process.exitCode = 1;
			ui.outro(hasFailure ? 'Drift found.' : 'No drift.');
			return { findings };
		});
	},
	async allow(action, email, raw) {
		const flags = toFlags(raw);
		await guarded(flags, async (ui) => {
			const ctx = readOnlyContext(ui, flags);
			const done = await ui.presenter.task(
				`${action === 'add' ? 'Allowing' : 'Removing'} ${email}`,
				() => changeAllowedEmail(ctx, action, email)
			);
			ui.outro(
				`${done.email} ${action === 'add' ? 'is now admitted by' : 'is no longer admitted by'} "${done.policyName}".`
			);
			return done;
		});
	},
	async teardown(raw) {
		const flags = toFlags(raw);
		await guarded(flags, async (ui) => {
			const ctx = readOnlyContext(ui, flags);
			ui.intro('Epoch teardown');
			const deleted = await runTeardown(ctx, modeOf(flags), ui.asker);
			ui.outro(
				deleted.length === 0
					? 'Nothing here is provably ours; nothing was deleted.'
					: `Deleted ${deleted.map((d) => d.name).join(', ')}.`
			);
			return { deleted };
		});
	},
	async spike(raw) {
		const flags = toFlags(raw);
		await guarded(flags, async (ui) => {
			ui.intro('Epoch setup spike');
			const outcome = await runSpike(ui.reporter, flags.isVerbose, flags.name);
			ui.showFindings(outcome.findings);
			ui.outro(`Raw responses are in ${outcome.directory}. Send back the pass/fail list above.`);
			return outcome;
		});
	}
};

export function buildProgram(handlers: Handlers = DEFAULT_HANDLERS): Command {
	const program = new Command();
	program
		.name('./setup')
		.description(
			'Install Epoch into your Cloudflare account, or check and change an install. With no command it runs setup.'
		)
		// Without this the program, which has the setup flags too, would swallow `--json`, `--yes` and
		// `--plan` that belong to a subcommand: `setup --plan` would apply, and `teardown --yes` would be ignored.
		.enablePositionalOptions()
		.showHelpAfterError();
	addSetupOptions(program).action((raw: RawOptions) => handlers.setup(raw));

	addSetupOptions(
		program.command('setup').description('Create or update the install (the default command)')
	).action((raw: RawOptions) => handlers.setup(raw));

	program
		.command('doctor')
		.description('Re-run the checks and report drift; changes nothing')
		.option('--json', 'print one JSON result on stdout')
		.option('--verbose', 'stream the cf and wrangler output')
		.action((raw: RawOptions) => handlers.doctor(raw));

	for (const [name, action] of [
		['allow', 'add'],
		['disallow', 'remove']
	] as const) {
		program
			.command(`${name} <email>`)
			.description(
				action === 'add'
					? 'Let an address through Access (only on the policy setup created)'
					: 'Stop admitting an address (only on the policy setup created)'
			)
			.option('--verbose', 'stream the cf output')
			.action((email: string, raw: RawOptions) => handlers.allow(action, email, raw));
	}

	program
		.command('teardown')
		.description('Delete only what this install made, after typed confirmations')
		.option('--yes', 'refused: teardown always needs typed names')
		.option('--verbose', 'stream the cf and wrangler output')
		.action((raw: RawOptions) => handlers.teardown(raw));

	program
		.command('spike')
		.option(
			'--name <name>',
			'whose resources to look for (default: the install here, then the deploy config, then epoch-genealogy)'
		)
		.description(
			'Check the assumptions that need a real account, read-only, and save the raw responses under .epoch/spike'
		)
		.option('--verbose', 'stream the cf and wrangler output')
		.action((raw: RawOptions) => handlers.spike(raw));

	return program;
}

async function runDefault(raw: RawOptions): Promise<void> {
	const flags = toFlags(raw);
	await guarded(flags, async (ui) => {
		const ctx = createContext({
			reporter: ui.reporter,
			isVerbose: flags.isVerbose,
			isReadOnly: flags.isPlanOnly,
			deployAuth: flags.deployAuth
		});
		// A signal skips `finally`, so the deploy token's deletion also hangs off the signal handlers.
		for (const signal of ['SIGINT', 'SIGTERM'] as const) {
			process.once(signal, () => {
				void ctx.cleanup.runAll().finally(() => process.exit(130));
			});
		}
		ui.intro('Epoch setup');
		try {
			const result = await runSetup(ctx, flags, modeOf(flags), ui.asker, ui.presenter);
			ui.outro(result.isApplied ? 'Epoch is installed.' : 'Plan only; nothing was changed.');
			return { manifest: result.manifest, plan: result.plan, checks: result.checks };
		} finally {
			await ctx.cleanup.runAll();
		}
	});
}

// Only when run directly, so tests can import `buildProgram` and `toFlags`.
if (import.meta.filename === process.argv[1]) {
	await buildProgram().parseAsync(process.argv);
}
