import { ERROR_CODES, SetupError } from './errors.ts';

/**
 * How a run may get answers. `isInteractive` is false without a TTY and under `--json`, which
 * must never prompt: stdout is the result object.
 */
export interface AnswerMode {
	isYes: boolean;
	isInteractive: boolean;
}

export const ANSWER_SOURCES = {
	flag: 'flag',
	only: 'only-choice',
	default: 'default'
} as const;
type AnswerSource = (typeof ANSWER_SOURCES)[keyof typeof ANSWER_SOURCES];

export type Resolution<T> =
	| { status: 'answered'; value: T; source: AnswerSource }
	/** The caller prompts, offering `defaultValue` first. */
	| { status: 'ask' };

interface QuestionInput<T> {
	/** The flag that answers this question, named in the error when nothing else can. */
	flag: string;
	flagValue: T | undefined;
	/** The one discovered candidate. A single account needs no question. */
	onlyChoice?: T | undefined;
	/** What `--yes` accepts. Absent means the question has no safe default. */
	defaultValue?: T | undefined;
}

/**
 * Order: the flag, then the only choice, then the default under `--yes`, then a prompt on a
 * terminal, then an error that names the flag. Nothing here ever hangs waiting on a TTY that
 * is not there.
 */
export function resolveAnswer<T>(input: QuestionInput<T>, mode: AnswerMode): Resolution<T> {
	if (input.flagValue !== undefined) {
		return { status: 'answered', value: input.flagValue, source: ANSWER_SOURCES.flag };
	}
	if (input.onlyChoice !== undefined) {
		return { status: 'answered', value: input.onlyChoice, source: ANSWER_SOURCES.only };
	}
	if (mode.isYes && input.defaultValue !== undefined) {
		return { status: 'answered', value: input.defaultValue, source: ANSWER_SOURCES.default };
	}
	if (mode.isInteractive) return { status: 'ask' };
	throw new SetupError(
		ERROR_CODES.missingAnswer,
		`No answer for ${input.flag}, and there is no terminal to ask on`,
		{
			flag: input.flag,
			hint: mode.isYes
				? `${input.flag} has no safe default; pass it explicitly.`
				: `Pass ${input.flag}, or add --yes to accept the discovered defaults.`
		}
	);
}

export function isTypedNameMatch(expected: string, typed: string): boolean {
	return typed.trim() === expected;
}

/**
 * Adopting an unmarked resource, re-attaching, and teardown need the exact name typed. `--yes`
 * exists to accept defaults, and a default must never be the thing that hands over a family tree.
 */
export function resolveTypedConfirmation(
	expected: string,
	typed: string | undefined,
	mode: AnswerMode
): 'confirmed' | 'ask' {
	if (typed !== undefined) {
		if (isTypedNameMatch(expected, typed)) return 'confirmed';
		throw new SetupError(ERROR_CODES.needsTypedConfirmation, `"${typed}" is not "${expected}"`);
	}
	if (mode.isYes || !mode.isInteractive) {
		throw new SetupError(
			ERROR_CODES.needsTypedConfirmation,
			`"${expected}" needs its name typed to confirm, which --yes and non-interactive runs cannot do`,
			{ hint: 'Run `npm run setup` in a terminal and type the name when asked.' }
		);
	}
	return 'ask';
}
