import { isConflict } from '#lib/api/tree-api.js';
import { messageOf } from '../feedback/error-message.js';

/**
 * Save state shared by the dialogs. `run` calls the dialog's `onsaved` itself because some dialogs
 * pass it extra arguments; a conflict goes to `onstale`, anything else becomes `error`.
 */
export function createSubmission(onstale: (message: string) => Promise<void> | void) {
	let isSaving = $state(false);
	let error = $state<string | null>(null);
	return {
		get isSaving() {
			return isSaving;
		},
		get error() {
			return error;
		},
		/** Dialogs set this for their own validation messages, which never reach `submit`. */
		set error(message: string | null) {
			error = message;
		},
		clearError() {
			error = null;
		},
		async submit(run: () => Promise<void>, fallback: string): Promise<void> {
			isSaving = true;
			error = null;
			try {
				await run();
			} catch (cause) {
				if (isConflict(cause)) await onstale(cause.message);
				else error = messageOf(cause, fallback);
			} finally {
				isSaving = false;
			}
		}
	};
}
