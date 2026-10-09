import type { ResourceKey } from './reconcile.ts';
import type { PolicyChoice } from './policy.ts';

export const HOSTINGS = { workersDev: 'workers-dev', custom: 'custom' } as const;
export type Hosting = (typeof HOSTINGS)[keyof typeof HOSTINGS];

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
	hosting?: Hosting;
	/** Custom domain only: keep the workers.dev URL on as well. Undefined means ask (default off). */
	isKeepWorkersDev?: boolean;
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
	name?: string;
}

export const DEFAULT_WORKER_NAME = 'epoch';

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
	workerName: string;
	account: { id: string; name: string };
	hosting: Hosting;
	/** Null with workers.dev only. */
	zone: { id: string; name: string } | null;
	/** The host Access protects `/login` on: the workers.dev host or the custom domain. */
	hostname: string;
	isWorkersDevKept: boolean;
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
