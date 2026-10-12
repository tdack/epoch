export const DEMO_URL = 'https://demo.epochgenealogy.app';
export const REPO_URL = 'https://github.com/tdack/epoch';
export const REPO_CLONE_URL = 'https://github.com/tdack/epoch.git';
export const BACKLOG_URL = 'https://github.com/tdack/epoch/blob/main/docs/backlog.md';
export const SITE_URL = 'https://epochgenealogy.app';

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
			'Two people who partner twice keep two partnerships, labelled and dated',
			'Step relationships worked out from a parent’s partnerships',
			'Several names per person, with a preferred display name'
		]
	},
	{
		title: 'Ways to see the family',
		text: 'A focus-centred family view kept in the address, so Back and shared links restore it.',
		points: [
			'Pedigree, descendants, fan and hourglass charts, each with a text outline',
			'Rings, Ball, Ribbons and Orrery: four 3D views of the whole tree',
			'A relationship finder that shows every route between two people',
			'Ranked search that says why each person matched'
		]
	},
	{
		title: 'Records and research',
		text: 'Pages for people, partnerships, places and sources, built around the evidence.',
		points: [
			'Sources, repositories and citations, showing what each source supports',
			'Places named by facts, with rename and merge',
			'Shared notes, research tasks and a data-quality report',
			'Media attached to people, kept private in your own storage'
		]
	},
	{
		title: 'Editing safely together',
		text: 'Several people can work on one tree without stepping on each other.',
		points: [
			'Owner, manager, editor, contributor and viewer roles per tree',
			'Every change shows an Undo, and the change log keeps the rest',
			'Two saves to the same record at once: the second is refused, not merged blind',
			'Deleting a person first shows exactly what it will affect'
		]
	},
	{
		title: 'GEDCOM in and out',
		text: 'Bring a tree from other software and take it with you again.',
		points: [
			'Validation and a preview before anything is written',
			'Duplicate families in a messy file offered for merging',
			'Export in GEDCOM 5.5.1 or 7.0',
			'Structures Epoch does not show yet are kept and written back out'
		]
	}
];

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
			'Inside a tree, each person has a role, and living people are hidden from anyone without the right to see them. Tree managers set that per tree.'
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
		question: 'Does it work on a phone?',
		answer: [
			'Record pages, lists and the family view have phone layouts. The 3D views are best on a larger screen.'
		]
	},
	{
		question: 'How is it related to webtrees?',
		answer: [
			'Epoch is inspired by the capabilities of webtrees, not its screens or code. It is a separate application, written for Cloudflare, and exchanges data with other software through GEDCOM.'
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
}

export const VIEWS_3D: View3d[] = [
	{
		id: 'rings',
		name: 'Rings',
		text: 'An overview to turn and explore: one ring for each generation, the youngest at the top and the oldest at the bottom, with lines up to the children.'
	},
	{
		id: 'ball',
		name: 'Ball',
		text: 'A glass ball with the family inside it. Height is the calendar, the oldest at the top; the wider a generation, the nearer its people sit to the glass.'
	},
	{
		id: 'ribbons',
		name: 'Ribbons',
		text: 'Each person is a ribbon of descent. A couple’s ribbons meet at a glowing knot, and their children’s ribbons branch out from it like a river delta.'
	},
	{
		id: 'orrery',
		name: 'Orrery',
		text: 'A star cluster. Partners circle each other as a pair of stars, and their children circle the pair.'
	}
];
