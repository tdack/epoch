declare module 'cloudflare:workers' {
	export abstract class WorkflowEntrypoint<Env = unknown, Params = unknown> {
		env: Env;
		ctx: ExecutionContext;
		constructor(ctx: ExecutionContext, env: Env);
		abstract run(event: WorkflowEvent<Params>, step: WorkflowStep): Promise<unknown>;
	}

	export interface WorkflowEvent<Params = unknown> {
		payload: Params;
		timestamp: Date;
		instanceId: string;
	}

	export interface WorkflowStep {
		do<T>(name: string, callback: () => Promise<T>): Promise<T>;
		do<T>(
			name: string,
			config: {
				retries?: {
					limit?: number;
					delay?: string | number;
					backoff?: 'constant' | 'linear' | 'exponential';
				};
				timeout?: string | number;
			},
			callback: () => Promise<T>
		): Promise<T>;
		sleep(name: string, duration: string | number): Promise<void>;
		sleepUntil(name: string, timestamp: Date | number): Promise<void>;
	}
}
