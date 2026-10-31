/**
 * The submitter a tree's GEDCOM export names (ADR-075). Shared so the settings form and the
 * service refuse the same input.
 */

export const MAX_SUBMITTER_NAME_LENGTH = 200;
export const MAX_SUBMITTER_EMAIL_LENGTH = 200;
export const MAX_SUBMITTER_WWW_LENGTH = 500;

export interface TreeSubmitter {
	name: string | null;
	email: string | null;
	www: string | null;
}

/** Empty text is no value, so a cleared field and a never-set one read the same. */
export function cleanSubmitter(value: {
	name?: string | null;
	email?: string | null;
	www?: string | null;
}): TreeSubmitter {
	const clean = (text: string | null | undefined) => text?.trim() || null;
	return { name: clean(value.name), email: clean(value.email), www: clean(value.www) };
}

/**
 * Why `submitter` cannot be saved, or null when it can. An email or address with no name would
 * never be written: an export names a submitter only when it has a name.
 */
export function submitterProblem(submitter: TreeSubmitter): string | null {
	if (!submitter.name && (submitter.email || submitter.www))
		return 'Enter the submitter’s name, or clear the email and web address.';
	if (submitter.name && submitter.name.length > MAX_SUBMITTER_NAME_LENGTH)
		return `The name can be at most ${MAX_SUBMITTER_NAME_LENGTH} characters.`;
	if (
		submitter.email &&
		(submitter.email.length > MAX_SUBMITTER_EMAIL_LENGTH ||
			!/^[^\s@]+@[^\s@]+$/.test(submitter.email))
	)
		return 'Enter an email address such as name@example.com.';
	if (submitter.www) {
		let isWeb = false;
		try {
			isWeb = ['http:', 'https:'].includes(new URL(submitter.www).protocol);
		} catch {
			// Not a URL; the message below says so.
		}
		if (!isWeb || submitter.www.length > MAX_SUBMITTER_WWW_LENGTH)
			return 'Enter a web address starting with http:// or https://.';
	}
	return null;
}
