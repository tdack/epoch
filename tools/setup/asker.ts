export interface Choice<T> {
	value: T;
	label: string;
	hint?: string;
}

/** What `collect` and the plan confirmation may ask. ui.ts implements it with clack; tests script it. */
export interface Asker {
	select<T>(options: { message: string; choices: Choice<T>[]; initial?: T }): Promise<T>;
	multiselect<T>(options: {
		message: string;
		choices: Choice<T>[];
		initial?: T[];
		isRequired: boolean;
	}): Promise<T[]>;
	text(options: {
		message: string;
		initial?: string;
		placeholder?: string;
		validate?: (value: string) => string | undefined;
	}): Promise<string>;
	confirm(options: { message: string; isInitiallyYes?: boolean }): Promise<boolean>;
}
