import { env } from 'cloudflare:workers';
import type { D1Database, R2Bucket, Queue, RateLimit, Workflow } from '@cloudflare/workers-types';
import type { ImportQueueMessage } from './services/gedcom-service.js';
import type { GedcomExportPayload } from './workflows/export-workflow.js';
import type { PlaceMatchPayload } from './workflows/place-match-workflow.js';

export interface PlatformBindings {
	DB: D1Database;
	MEDIA_BUCKET: R2Bucket;
	GEDCOM_IMPORT_QUEUE?: Queue<ImportQueueMessage>;
	GEDCOM_IMPORT_WORKFLOW?: Workflow<ImportQueueMessage>;
	GEDCOM_EXPORT_WORKFLOW?: Workflow<GedcomExportPayload>;
	PLACE_MATCH_WORKFLOW?: Workflow<PlaceMatchPayload>;
	PUBLIC_READ_RATE_LIMIT?: RateLimit;
	// shortcut: both are Worker secrets, not setup-managed vars, so only installs that store them are
	// gated (ADR-084); move the site key into setup's deploy values if Turnstile becomes a setup step.
	/** Set turns the anonymous public-read challenge on. */
	TURNSTILE_SITE_KEY?: string;
	/** Required once the site key is set; without it every anonymous read is refused. */
	TURNSTILE_SECRET?: string;
}

/**
 * Access typed Cloudflare resource bindings.
 * Uses the native Cloudflare Workers runtime `cloudflare:workers` module,
 * which is supported in both local development (via Vite proxy) and production.
 */
export function getPlatformBindings(): PlatformBindings {
	return env as unknown as PlatformBindings;
}
