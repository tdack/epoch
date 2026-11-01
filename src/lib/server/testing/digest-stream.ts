/**
 * Installs `crypto.DigestStream`, which exists only on the Workers runtime, so code that streams a
 * digest can run under Node. It buffers the chunks and digests them on close, which is fine for a
 * test and is why production code never imports this.
 */
export function installDigestStreamShim(): void {
	const target = crypto as unknown as { DigestStream?: unknown };
	if (target.DigestStream) return;
	target.DigestStream = class {
		readonly digest: Promise<ArrayBuffer>;
		readonly writable: WritableStream<Uint8Array>;
		constructor(algorithm: string) {
			const chunks: Uint8Array[] = [];
			let resolve!: (value: ArrayBuffer) => void;
			this.digest = new Promise((r) => (resolve = r));
			this.writable = new WritableStream<Uint8Array>({
				write: (chunk) => void chunks.push(chunk.slice()),
				close: async () => {
					const whole = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
					let at = 0;
					for (const chunk of chunks) {
						whole.set(chunk, at);
						at += chunk.length;
					}
					resolve(await crypto.subtle.digest(algorithm, whole));
				}
			});
		}
		getWriter() {
			return this.writable.getWriter();
		}
	};
}
