import type { D1Database, R2Bucket, Queue } from '@cloudflare/workers-types';

declare global {
	namespace App {
		interface Platform {
			env: {
				DB: D1Database;
				MEDIA_BUCKET: R2Bucket;
				GEDCOM_IMPORT_QUEUE?: Queue<any>;
				GEDCOM_EXPORT_WORKFLOW?: any;
				CF_IMAGES_TOKEN?: string;
				CF_ACCOUNT_ID?: string;
			};
			context: ExecutionContext;
			caches: CacheStorage;
		}
	}
}

export {};

