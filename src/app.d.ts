import type { D1Database, R2Bucket, Queue, SendEmail } from '@cloudflare/workers-types';
import type { UserIdentity } from '#lib/server/domain/identity.js';

declare global {
	namespace App {
		interface Locals {
			user: UserIdentity | null;
			correlationId: string;
		}
		interface Platform {
			env: {
				DB: D1Database;
				MEDIA_BUCKET: R2Bucket;
				GEDCOM_IMPORT_QUEUE?: Queue<any>;
				GEDCOM_EXPORT_WORKFLOW?: any;
				/** Absent in unit tests and bare previews; invitations are then saved but not emailed. */
				EMAIL?: SendEmail;
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
