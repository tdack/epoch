import type {
	D1Database,
	Queue,
	R2Bucket,
	RateLimit,
	SendEmail,
	Workflow
} from '@cloudflare/workers-types';
import type { AccessIdentity, UserIdentity } from '#lib/server/domain/identity.js';
import type { HostTree } from '#lib/shared/tree-host.js';
import type { ImportQueueMessage } from '#lib/server/services/gedcom-service.js';
import type { GedcomExportPayload } from '#lib/server/workflows/export-workflow.js';

declare global {
	/** The short commit this build was made from (`vite.config.ts`); null when it was not known. */
	const __EPOCH_COMMIT__: string | null;

	namespace App {
		interface Locals {
			/** Set only for someone Epoch admits (ADR-034); null for the signed out and the not admitted alike. */
			user: UserIdentity | null;
			/** Who Access named when Epoch did not admit them; kept only for this request, never stored. */
			notAdmitted: AccessIdentity | null;
			correlationId: string;
			/** The tree this request's host is pinned to, or null on the app host. */
			hostTree: HostTree | null;
		}
		interface Platform {
			env: {
				DB: D1Database;
				MEDIA_BUCKET: R2Bucket;
				GEDCOM_IMPORT_QUEUE?: Queue<ImportQueueMessage>;
				GEDCOM_EXPORT_WORKFLOW?: Workflow<GedcomExportPayload>;
				/** The four below are absent in unit tests and bare previews; a missing one allows the request (ADR-066). */
				UPLOAD_RATE_LIMIT?: RateLimit;
				IMPORT_RATE_LIMIT?: RateLimit;
				CSP_REPORT_RATE_LIMIT?: RateLimit;
				PUBLIC_READ_RATE_LIMIT?: RateLimit;
				/** Absent in unit tests and bare previews; invitations are then saved but not emailed. */
				EMAIL?: SendEmail;
				/** Set by setup alongside `EMAIL`; the one address its `allowed_sender_addresses` names. */
				EPOCH_EMAIL_SENDER?: string;
				/** Where visitors are offered this install's source (AGPL section 13); upstream when unset. */
				EPOCH_SOURCE_URL?: string;
				/** Trees with the flag on are served at `<slug>.<zone>`; unset turns the feature off. */
				EPOCH_TREE_HOST_ZONE?: string;
				/** The whole install's host when it is not the zone itself, such as `epoch.example.com`. */
				EPOCH_APP_HOST?: string;
				/** Comma-separated labels the zone uses for something else, such as `demo`. */
				EPOCH_RESERVED_SUBDOMAINS?: string;
				CF_ACCESS_TEAM_DOMAIN?: string;
				CF_ACCESS_AUD?: string;
				ACCESS_BYPASS_DEV?: string;
			};
			context: ExecutionContext;
			caches: CacheStorage;
		}
	}
}

export {};
