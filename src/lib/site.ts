import type { LensId } from './family.js';

export const DEMO_URL = 'https://demo.epochgenealogy.app';
/** A public sub-tree on the demo (ADR-069); a bare address opens on its starting person. */
export const DEMO_SUBTREE_URL = `${DEMO_URL}/trees/windsor-glucksburg-extended-lineage~windsor-line`;
export const REPO_URL = 'https://github.com/tdack/epoch';
export const REPO_CLONE_URL = 'https://github.com/tdack/epoch.git';
export const BACKLOG_URL = 'https://github.com/tdack/epoch/blob/main/docs/backlog.md';
export const LICENSE_URL = 'https://github.com/tdack/epoch/blob/main/LICENSE';
export const SITE_URL = 'https://www.epochgenealogy.app';

/** The app's own tagline (PRODUCT.md, Brand Commitments); keep it word for word. */
export const TAGLINE = 'A private family history, shared with the people who help keep it.';

export interface Principle {
	term: string;
	text: string;
}

export const PRINCIPLES: Principle[] = [
	{
		term: 'Private',
		text: 'Each family runs its own copy on its own Cloudflare account. Access is by invitation only, and living people stay hidden from anyone without the right.'
	},
	{
		term: 'Shared',
		text: "Relatives and researchers edit the same tree, each with their own role. Every change is logged and can be undone, and a clashing save is refused rather than overwriting someone else's."
	},
	{
		term: 'Yours to take',
		text: 'GEDCOM in with a preview, GEDCOM out in 5.5.1 or 7.0, including structures Epoch does not show yet. No platform holds or mines the data.'
	},
	{
		term: 'No server',
		text: 'Built on Cloudflare Workers, D1, R2, Queues and Workflows. There is no machine to patch or keep running.'
	}
];

export interface FeatureGroup {
	title: string;
	text: string;
	points: string[];
}

export const FEATURE_GROUPS: FeatureGroup[] = [
	{
		title: 'A tree that handles real families',
		text: 'A child can have more than one parental family, and every link says what kind it is.',
		points: [
			'Biological, adoptive, foster, guardian and unknown parentage',
			'Partnerships with separation, divorce, annulment, death and remarriage',
			'Step relationships worked out from a parent’s partnerships'
		]
	},
	{
		title: 'Ways to see the family',
		text: 'A focus-centred family view kept in the address, so Back and shared links restore it.',
		points: [
			'Pedigree, descendants, fan and hourglass charts, each with a text outline',
			'A relationship finder that shows every route between two people',
			'Ranked search that says why each person matched'
		]
	},
	{
		title: 'Records and research',
		text: 'Pages for people, partnerships, places and sources, built around the evidence.',
		points: [
			'Sources, repositories and citations, showing what each source supports',
			'Shared notes, research tasks and a data-quality report',
			'Media attached to people, kept private in your own storage'
		]
	},
	{
		title: 'Editing safely together',
		text: 'Several people can work on one tree without stepping on each other.',
		points: [
			'Five roles per tree, from viewer to owner, each adding to the one before',
			'Every change shows an Undo, and an audit log keeps the rest, by person and day',
			'Two saves to the same record at once: the second is refused, not merged blind'
		]
	},
	{
		title: 'GEDCOM in and out',
		text: 'Bring a tree from other software and take it with you again.',
		points: [
			'Validation and a preview before anything is written',
			'Duplicate families in a messy file offered for merging',
			'Structures Epoch does not show yet are kept and written back out'
		]
	}
];

export interface Role {
	name: string;
	/** What the role is for, in a few words. */
	summary: string;
	/** Only what this role adds to the one before it; the ladder carries the rest. `[text](url)` links. */
	adds: string[];
	/** What this role sees where it differs from the role before, or a rule that binds it. */
	note?: string;
}

/**
 * Each tree role, lowest first, as `authorization.ts`, `roles.ts`, `member-service.ts` and
 * `change-audit.ts` on `main` decide them. Contributor suggestions awaiting approval are still in
 * the backlog, so nothing here may imply them.
 */
export const ROLES: Role[] = [
	{
		name: 'Viewer',
		summary: 'Looks the family up.',
		adds: ['Browses people, places, the charts and the 3D views', 'Searches and opens files'],
		note: 'Living and private people are hidden.'
	},
	{
		name: 'Contributor',
		summary: 'Adds what they know.',
		adds: [
			'Adds people and the relationships between them',
			'Adds citations, notes and research tasks',
			'Changes their own tasks'
		],
		note: 'Sees the living people they added. Anyone marked private stays hidden.'
	},
	{
		name: 'Editor',
		summary: 'Keeps the records right.',
		adds: [
			'Changes and deletes any record',
			'Imports GEDCOM files',
			'Uploads files, and deletes their own',
			'Reads the audit log and undoes their own changes'
		],
		note: 'Sees everyone, private people included.'
	},
	{
		name: 'Manager',
		summary: 'Looks after the tree and its members.',
		adds: [
			'Invites editors, contributors and viewers, and changes their roles',
			'Decides who is private, and sets the tree’s settings',
			'Exports the tree as GEDCOM, living people included',
			'[Makes sub-trees](/sub-trees) for one family line at a time',
			'Chooses which sub-trees visitors to a public tree can open',
			'Undoes anyone’s change and deletes anyone’s files'
		]
	},
	{
		name: 'Owner',
		summary: 'Holds the tree.',
		adds: [
			'Invites managers and other owners',
			'Chooses the view the tree opens in',
			'Deletes the tree'
		],
		note: 'A tree always keeps at least one owner.'
	}
];

/** The roles page: the ladder of tree roles. */
export const ROLES_PAGE = {
	path: '/roles',
	title: 'Who can do what',
	description:
		'The five roles in an Epoch tree, from viewer to owner. Each role can do everything the one before it can, and adds the things listed with it.',
	lede: 'Everyone in a tree has one role. Each role can do everything the one before it can, and adds the things listed with it.'
};

/** The sub-trees page: what a sub-tree holds, what it narrows and what it leaves whole. */
export const SUBTREES_PAGE = {
	path: '/sub-trees',
	title: 'Sub-trees',
	description:
		'A sub-tree is one family line from a large Epoch tree: a person, their descendants and the partners of all of them. It narrows the lists, not what people can see.',
	lede: 'One family line from a large tree.',
	/** Plain paragraphs; `[text](url)` becomes a link. */
	paragraphs: [
		'A tree of several hundred people is several families in one file. A [manager](/roles) can name a sub-tree that starts at one person, such as a Marsh line starting at William Marsh. It appears under the tree in the tree switcher and has its own address to share.',
		'A sub-tree holds the person it starts at, everyone descended from them through any parentage that is not disputed, and the partners of all of those people. Lines can overlap, so one person can be in several sub-trees.',
		`The demo has one to open: [the Windsor line](${DEMO_SUBTREE_URL}), starting at Elizabeth II.`
	],
	/** The note under the scope lists. */
	note: 'A sub-tree is a way into the tree, not a wall around part of it. Nobody outside the line is hidden, and privacy works as it does everywhere else. A sub-tree is for members until a manager shows it to visitors of a public tree, and every change to one can be undone.',
	closeTitle: 'Open a sub-tree in the demo.',
	closeAction: 'Open the Windsor line'
};

/** The sentence on the home page that points to the two pages above. `[text](url)` links. */
export const FEATURES_MORE =
	'Every tree role adds to the one before it: see [who can do what](/roles). A manager can also cut a large tree down to one family line with [sub-trees](/sub-trees).';

/** What a sub-tree narrows and what it leaves whole (ADR-062 on `main`). */
export const SUBTREE_SCOPE = {
	narrowed: [
		'The person the chart opens on',
		'The people, surname, partnership and place lists',
		'Search, the person finder and the people count'
	],
	whole: [
		'Sources, notes, tasks and files',
		'Every edit, the change log and Undo',
		'GEDCOM export, always the whole tree'
	]
} as const;

export interface Faq {
	question: string;
	/** Plain paragraphs; a link is written as [text](url). */
	answer: string[];
}

export const FAQS: Faq[] = [
	{
		question: 'What does it cost to run?',
		answer: [
			'Epoch runs on your own Cloudflare account, which needs a paid Workers plan. Cloudflare bills you for that directly. There is no Epoch subscription.'
		]
	},
	{
		question: 'Who can see our tree?',
		answer: [
			'Only the people you let in. Cloudflare Access handles sign-in, and Epoch then admits only the install owner, members of a tree and people with an open invitation. Anyone else who signs in is told to ask the owner for an invitation, and nothing is stored about them.',
			'Inside a tree, each person has a role, and living people are hidden from anyone without the right to see them. Tree managers set that per tree. [What each role can do](/roles).'
		]
	},
	{
		question: 'What is in the demo?',
		answer: [
			'A tree you can browse without signing in. Editing, invitations and GEDCOM import need an install of your own.'
		]
	},
	{
		question: 'Can I bring my tree from other software?',
		answer: [
			'Yes, as a GEDCOM file, which most family-tree programs and sites can export. Epoch validates the file and shows a preview before anything is written, and offers to merge duplicate families it finds.',
			'Anything in the file that Epoch does not show yet is kept, and written back out when you export.'
		]
	},
	{
		question: 'What happens when two of us edit the same person?',
		answer: [
			'The first save wins and the second is refused with an explanation, so nobody’s work is overwritten silently. Every change also shows an Undo, which reverts your own latest change and says why if someone has changed the same records since.'
		]
	},
	{
		question: 'Do I need my own domain?',
		answer: [
			'No. Setup can give you a workers.dev address, or use one custom domain that is already active on your Cloudflare account.'
		]
	},
	{
		question: 'Can I leave, or take the data with me?',
		answer: [
			'Export the whole tree as GEDCOM 5.5.1 or 7.0 at any time. If you stop using Epoch, `./setup teardown` deletes only what setup created.'
		]
	},
	{
		question: 'Is it open source?',
		answer: [
			'Yes. Epoch is licensed under the [GNU Affero General Public License, version 3 or later](' +
				LICENSE_URL +
				').'
		]
	},
	{
		question: 'Does it work on a phone?',
		answer: [
			'Record pages, lists and the family view have phone layouts. The 3D views are best on a larger screen.'
		]
	},
	{
		question: 'How is it related to webtrees?',
		answer: [
			'Epoch is inspired by the capabilities of webtrees, not its screens or code. It is a separate application, written to be hosted using Cloudflare, and exchanges data with other software through GEDCOM.'
		]
	},
	{
		question: 'Is Epoch ready for my family’s records?',
		answer: [
			'Epoch is young and under active development. Known gaps and planned work, such as printable reports, timelines and maps, are listed in [the backlog](' +
				BACKLOG_URL +
				'). Export your tree as GEDCOM regularly, whatever software you use.'
		]
	}
];

export interface View3d {
	id: 'rings' | 'ball' | 'ribbons' | 'orrery';
	name: string;
	/** The app's own description of the view (TreeToolbar on `main`). */
	text: string;
	/** A screen recording of the view in the app, under `static/views/`; until one exists the panel shows an illustration. */
	video?: string;
	/** The recording's first frame, shown before it plays and under reduced motion. */
	poster?: string;
}

/**
 * Bumped with every re-recording: the zone's edge cache keeps a clip under its URL whatever the
 * Worker deploys, so a new take needs a new URL.
 */
const CLIP_VERSION = '2';

export const VIEWS_3D: View3d[] = [
	{
		id: 'rings',
		video: `/views/rings.mp4?v=${CLIP_VERSION}`,
		poster: `/views/rings-poster.jpg?v=${CLIP_VERSION}`,
		name: 'Rings',
		text: 'An overview to turn and explore: one ring for each generation, the youngest at the top and the oldest at the bottom, with lines up to the children.'
	},
	{
		id: 'ball',
		video: `/views/ball.mp4?v=${CLIP_VERSION}`,
		poster: `/views/ball-poster.jpg?v=${CLIP_VERSION}`,
		name: 'Ball',
		text: 'A glass ball with the family inside it. Height is the calendar, the oldest at the top; the wider a generation, the nearer its people sit to the glass.'
	},
	{
		id: 'ribbons',
		video: `/views/ribbons.mp4?v=${CLIP_VERSION}`,
		poster: `/views/ribbons-poster.jpg?v=${CLIP_VERSION}`,
		name: 'Ribbons',
		text: 'Each person is a ribbon of descent. A couple’s ribbons meet at a glowing knot, and their children’s ribbons branch out from it like a river delta.'
	},
	{
		id: 'orrery',
		video: `/views/orrery.mp4?v=${CLIP_VERSION}`,
		poster: `/views/orrery-poster.jpg?v=${CLIP_VERSION}`,
		name: 'Orrery',
		text: 'A star cluster. Partners circle each other as a pair of stars, and their children circle the pair.'
	}
];

export interface Lens {
	id: LensId;
	/** The app's own name for the view: the chart style links and the tree toolbar. */
	name: string;
	text: string;
}

/** The 2D ways of seeing one family, in the order the explorer moves through them. */
export const LENSES: Lens[] = [
	{
		id: 'family',
		name: 'Family view',
		text: 'Everyone on one page, ancestors above and descendants below. Each link is drawn as the kind it is, and a living person you may not see stays as a private placeholder.'
	},
	{
		id: 'descendants',
		name: 'Descendants',
		text: 'Everyone descended from one person, a generation to a column, each card naming the person’s partners.'
	},
	{
		id: 'hourglass',
		name: 'Hourglass',
		text: 'Descendants to the left and ancestors to the right, meeting at one person.'
	},
	{
		id: 'pedigree',
		name: 'Ancestors',
		text: 'Four generations by default and up to eight. Where nobody is recorded, the place stays empty rather than guessed.'
	},
	{
		id: 'fan',
		name: 'Fan',
		text: 'The same ancestors on a half circle: the person at the centre, a ring for each generation, and each person’s parents side by side.'
	},
	{
		id: 'relationship',
		name: 'Relationship',
		text: 'Choose two people and every route between them is listed, nearest first, naming the common ancestors and any link that is not biological.'
	}
];
