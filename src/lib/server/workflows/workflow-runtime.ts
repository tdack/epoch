/**
 * The export workflow's only contact with the Cloudflare workflow runtime.
 *
 * Vitest resolves neither `WorkflowEntrypoint` (its `cloudflare:workers` shim omits that class) nor
 * `cloudflare:workflows` at all, so both value imports are quarantined here. The workflow test mocks
 * this module, and the step logic then runs against a fake base class and error with no runtime
 * present. Production resolves the real modules.
 */

import { WorkflowEntrypoint } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';

export { NonRetryableError, WorkflowEntrypoint };
