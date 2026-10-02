export interface LoggerContext {
	correlationId?: string;
	userId?: string;
	treeId?: string;
	[key: string]: unknown;
}

const REDACTED_KEYS = new Set([
	'authorization',
	'cookie',
	'cf-access-jwt-assertion',
	'cf_authorization',
	'token',
	'password',
	'secret'
]);

function sanitizeData(data: unknown): unknown {
	if (data === null || typeof data !== 'object') {
		return data;
	}

	if (Array.isArray(data)) {
		return data.map(sanitizeData);
	}

	const sanitized: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
		if (REDACTED_KEYS.has(key.toLowerCase())) {
			sanitized[key] = '[REDACTED]';
		} else {
			sanitized[key] = sanitizeData(value);
		}
	}
	return sanitized;
}

export class Logger {
	constructor(private context: LoggerContext = {}) {}

	public child(extraContext: LoggerContext): Logger {
		return new Logger({ ...this.context, ...extraContext });
	}

	public info(message: string, data?: Record<string, unknown>): void {
		this.log('INFO', message, data);
	}

	public warn(message: string, data?: Record<string, unknown>): void {
		this.log('WARN', message, data);
	}

	public error(message: string, error?: unknown, data?: Record<string, unknown>): void {
		const errorData: Record<string, unknown> = { ...data };
		if (error instanceof Error) {
			errorData.errorName = error.name;
			errorData.errorMessage = error.message;
			errorData.stack = error.stack;
		} else if (error) {
			errorData.rawError = String(error);
		}
		this.log('ERROR', message, errorData);
	}

	private log(
		level: 'INFO' | 'WARN' | 'ERROR',
		message: string,
		data?: Record<string, unknown>
	): void {
		const entry = {
			timestamp: new Date().toISOString(),
			level,
			message,
			context: this.context,
			...(data ? { data: sanitizeData(data) } : {})
		};

		const formatted = JSON.stringify(entry);
		if (level === 'ERROR') {
			console.error(formatted);
		} else if (level === 'WARN') {
			console.warn(formatted);
		} else {
			console.log(formatted);
		}
	}
}

export const logger = new Logger();
