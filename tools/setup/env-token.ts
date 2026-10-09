import type { FileSystem } from './context.ts';

/** The `CLOUDFLARE_API_TOKEN` both tools would use: the shell's first, then `.env`'s. */
export function readEnvToken(
	env: NodeJS.ProcessEnv,
	fs: FileSystem,
	envFile: string
): string | null {
	if (env.CLOUDFLARE_API_TOKEN) return env.CLOUDFLARE_API_TOKEN;
	if (!fs.exists(envFile)) return null;
	const match = /^\s*(?:export\s+)?CLOUDFLARE_API_TOKEN\s*=\s*['"]?([^'"\n]+)/m.exec(
		fs.read(envFile)
	);
	return match?.[1]?.trim() ?? null;
}
