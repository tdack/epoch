import { COLOR, escapeHtml, renderEmailShell, type RenderedEmail } from './email-shell';

interface FarewellOwner {
	name: string | null;
	email: string;
}

interface FarewellTree {
	name: string;
	/** The tree's owners other than the person leaving; empty if the tree has no other owner on record. */
	owners: FarewellOwner[];
}

export interface FarewellTemplateInput {
	/** The person's display name, if they have one. */
	name: string | null;
	/** Captured before the memberships were deleted, which is the only time they can be read. */
	trees: FarewellTree[];
	/** Any URL on the Epoch origin; only its origin is used, to find the mark. */
	origin: string;
}

const ownerLabel = (owner: FarewellOwner) =>
	owner.name ? `${owner.name} (${owner.email})` : owner.email;

const SUBJECT = 'Sorry to see you go';

export function renderFarewellEmail(input: FarewellTemplateInput): RenderedEmail {
	const { name, trees, origin } = input;
	const e = escapeHtml;
	const greeting = name ? `Hi ${name},` : 'Hello,';
	const iconUrl = new URL('/brand/icon-192.png', origin).href;

	const treeLines = trees.map((tree) => {
		const owners = tree.owners.map(ownerLabel);
		return { name: tree.name, owners };
	});

	const treeHtml = treeLines.length
		? `<p style="margin:0 0 8px 0;">You were a member of:</p>
<ul style="margin:0 0 16px 0;padding-left:20px;">
${treeLines
	.map(
		(t) =>
			`<li style="margin:0 0 6px 0;"><strong style="color:${COLOR.ink};">${e(t.name)}</strong>${
				t.owners.length
					? `<br><span style="color:${COLOR.muted};font-size:14px;line-height:21px;">Owner: ${t.owners.map(e).join(', ')}</span>`
					: ''
			}</li>`
	)
	.join('\n')}
</ul>`
		: '';

	const cardHtml = `<h1 style="margin:0 0 16px 0;font-size:22px;line-height:30px;font-weight:700;color:${COLOR.ink};">Sorry to see you go</h1>
<p style="margin:0 0 16px 0;">${e(greeting)}</p>
<p style="margin:0 0 16px 0;">You have left Epoch. Thank you for the time and care you put into the family history.</p>
<p style="margin:0 0 16px 0;"><strong style="color:${COLOR.ink};">What we removed:</strong> your access to every tree, your settings and your profile picture.</p>
<p style="margin:0 0 16px 0;"><strong style="color:${COLOR.ink};">What stays:</strong> the changes you made remain in the trees&rsquo; history under your name.</p>
${treeHtml}<p style="margin:0;">If you would like to come back, ask the owner of the tree to invite you again.</p>`;

	const footerHtml =
		'You are receiving this because you chose to leave Epoch. Nothing more is needed from you.';

	const text = [
		greeting,
		'',
		'You have left Epoch. Thank you for the time and care you put into the family history.',
		'',
		'What we removed: your access to every tree, your settings and your profile picture.',
		"What stays: the changes you made remain in the trees' history under your name.",
		'',
		...(treeLines.length
			? [
					'You were a member of:',
					...treeLines.map(
						(t) => `- ${t.name}${t.owners.length ? ` (owner: ${t.owners.join(', ')})` : ''}`
					),
					''
				]
			: []),
		'If you would like to come back, ask the owner of the tree to invite you again.',
		'',
		footerHtml
	].join('\n');

	return {
		subject: SUBJECT,
		html: renderEmailShell({ title: SUBJECT, iconUrl, cardHtml, footerHtml }),
		text
	};
}
