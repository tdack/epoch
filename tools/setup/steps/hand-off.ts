import { withStepDone, type Manifest } from '../manifest.ts';
import { OWNERSHIPS } from '../manifest.ts';

/** What to tell the user at the end. Plain strings; ui.ts decides how they look. */
export function handOff(manifest: Manifest): { manifest: Manifest; lines: string[] } {
	const host = manifest.hostname ?? '';
	const hasOwnedPolicy = manifest.access.policies.some((p) => p.ownership === OWNERSHIPS.owned);
	const names = manifest.access.policies.map((p) => `"${p.name}"`).join(', ');
	const lines = [
		`Epoch is at https://${host}`,
		`Sign in as ${manifest.ownerEmail ?? 'the owner'}, then create your first tree: that makes you its owner.`,
		`Access lets in whoever the policy ${names || '(none)'} admits.`,
		hasOwnedPolicy
			? 'To let someone else sign in: `./setup allow <email>`, then invite them inside Epoch.'
			: 'To let someone else sign in, add them to that policy in the Cloudflare dashboard, then invite them inside Epoch.',
		'Later deploys: `npm run deploy` under the bound profiles.',
		'Install record: .epoch/install.json'
	];
	return { manifest: withStepDone(manifest, 'hand-off'), lines };
}
