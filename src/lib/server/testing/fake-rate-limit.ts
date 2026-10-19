/** A Workers Rate Limiting binding that allows `allowed` calls and refuses the rest, recording the keys. */
export class FakeRateLimit implements RateLimit {
	readonly keys: string[] = [];

	constructor(private allowed: number) {}

	async limit({ key }: RateLimitOptions): Promise<RateLimitOutcome> {
		this.keys.push(key);
		return { success: this.keys.length <= this.allowed };
	}
}
