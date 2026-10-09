import type { ResourceKey } from './reconcile.ts';
import type { PolicyChoice } from './policy.ts';

export const DEPLOY_AUTHS = { wrangler: 'wrangler', ephemeral: 'ephemeral' } as const;
type DeployAuth = (typeof DEPLOY_AUTHS)[keyof typeof DEPLOY_AUTHS];

/** Every flag of the default command. Each prompt has a matching one (plan, "Running without prompts"). */
export interface SetupFlags {
	isYes: boolean;
	isJson: boolean;
	isVerbose: boolean;
	isPlanOnly: boolean;
	isForce: boolean;
	account?: string;
	zone?: string;
	hostname?: string;
	policy?: string[];
	isNewPolicy: boolean;
	idp?: string[];
	d1Location?: string;
	r2Location?: string;
	r2Jurisdiction?: string;
	emailSender?: string;
	ownerEmail?: string;
	deployAuth: DeployAuth;
	isApiTokenEnv: boolean;
	isBrowser: boolean;
	isDevice: boolean;
	slug?: string;
}

export const DEFAULT_SLUG = 'epoch';

export const DEFAULT_FLAGS: SetupFlags = {
	isYes: false,
	isJson: false,
	isVerbose: false,
	isPlanOnly: false,
	isForce: false,
	isNewPolicy: false,
	deployAuth: DEPLOY_AUTHS.wrangler,
	isApiTokenEnv: false,
	isBrowser: true,
	isDevice: true
};

/** Collected before anything is created. Steps read these and never prompt. */
export interface Answers {
	slug: string;
	account: { id: string; name: string };
	zone: { id: string; name: string };
	hostname: string;
	ownerEmail: string;
	idpIds: string[];
	policy: PolicyChoice;
	d1Location: string | null;
	r2Location: string | null;
	r2Jurisdiction: string | null;
	/** A sender on a verified Email Sending domain, or null to leave `send_email` out. */
	emailSender: string | null;
	/** Names typed to adopt or re-attach, by resource. Only a person at a terminal can supply these. */
	typedAdoptions: Partial<Record<ResourceKey, string>>;
}
