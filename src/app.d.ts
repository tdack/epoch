import type { D1Database, R2Bucket, Queue, SendEmail, Workflow } from '@cloudflare/workers-types';
import type { AccessIdentity, UserIdentity } from '#lib/server/domain/identity.js';
import type { GedcomExportPayload } from '#lib/server/workflows/export-workflow.js';

declare global {
	namespace App {
		interface Locals {
			/** Set only for someone Epoch admits (ADR-034); null for the signed out and the not admitted alike. */
			user: UserIdentity | null;
			/** Who Access named when Epoch did not admit them; kept only for this request, never stored. */
			notAdmitted: AccessIdentity | null;
			correlationId: string;
		}
		interface Platform {
			env: {
				DB: D1Database;
				MEDIA_BUCKET: R2Bucket;
				GEDCOM_IMPORT_QUEUE?: Queue<any>;
				GEDCOM_EXPORT_WORKFLOW?: Workflow<GedcomExportPayload>;
				/** Absent in unit tests and bare previews; invitations are then saved but not emailed. */
				EMAIL?: SendEmail;
				/** Set by setup alongside `EMAIL`; the one address its `allowed_sender_addresses` names. */
				EPOCH_EMAIL_SENDER?: string;
				CF_IMAGES_TOKEN?: string;
				CF_ACCOUNT_ID?: string;
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
