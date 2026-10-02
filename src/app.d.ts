import type { D1Database, R2Bucket, Queue } from '@cloudflare/workers-types';
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
