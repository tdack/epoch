import type { LensId } from './family.js';

export const DEMO_URL = 'https://demo.epochgenealogy.app';
/** A public sub-tree on the demo (ADR-069); a bare address opens on its starting person. */
const DEMO_TREE_URL = `${DEMO_URL}/trees/windsor-glucksburg-extended-lineage`;
export const DEMO_SUBTREE_URL = `${DEMO_TREE_URL}~windsor-line`;
export const DEMO_REPORTS_URL = `${DEMO_TREE_URL}/reports`;
export const DEMO_PLACES_URL = `${DEMO_TREE_URL}/places`;
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
			'An Overview of the family’s span, its anniversaries and the latest changes',
			'Pedigree, descendants, fan and hourglass charts, each with a text outline',
			'A relationship finder that shows every route between two people',
			'Ranked search that says why each person matched'
		]
	},
	{
		title: 'Records and research',
		text: 'Pages for people, partnerships, places and sources, built around the evidence.',
		points: [
			'Dates in words, “about 1900” rather than “ABT 1900”, in the format the tree chooses',
			'Sources, repositories and citations, showing what each source supports',
			'Shared notes, research tasks and a data-quality report',
			'Media attached to people, kept private in your own storage'
		]
	},
	{
		title: 'Reports, printing and maps',
		text: 'Read the family as a book, print it for the wall, and see where its lives were lived.',
		points: [
			'Narratives, a family group sheet, a family book and other reports, all printable',
			'The family view as a poster sized to the drawing, printed or saved as a PDF',
			'Places on an OpenStreetMap map, and each person’s life traced across it'
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
		adds: [
			'Browses people, places, the charts and the 3D views',
			'Searches and opens files',
			'Reads, prints and downloads the [reports](/reports)'
		],
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
			'Sets where a place is on the [map](/maps)',
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
			'Decides who is private, and sets the tree’s settings, such as how dates are written',
			'Matches the tree’s places to map locations',
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

/** The reports page: what there is to read and how it prints. */
export const REPORTS_PAGE = {
	path: '/reports',
	title: 'Reports and printing',
	description:
		'Epoch’s reports tell a family as narratives, sheets and a family book, and print from the browser. The family view prints as a poster sized to the drawing, or saves as a PDF.',
	lede: 'Read the family as a book, a sheet or a wall chart, and print it from the browser.',
	/** Plain paragraphs; `[text](url)` becomes a link. */
	paragraphs: [
		'Every tree has its reports under Research. Each one is an ordinary page that reads the tree as you may see it, so a printout never shows more than the screen. Living and private people stay hidden from anyone without the [right to see them](/roles).',
		'The narratives tell a family in sentences: “born about 1900”, never “ABT 1900”. A partnership is called a marriage only when a marriage is recorded, an adoption is said as one, and the sources become numbered endnotes.'
	],
	closeTitle: 'Read the demo family as a book.',
	closeAction: 'Open the demo’s reports'
};

export interface Report {
	name: string;
	text: string;
}

export interface ReportGroup {
	title: string;
	reports: Report[];
}

/** The reports hub on `main` (`/trees/[id]/reports`), in its order. ADR-080 lists them. */
export const REPORT_GROUPS: ReportGroup[] = [
	{
		title: 'About a person',
		reports: [
			{ name: 'Individual summary', text: 'The person’s page, printed without its buttons.' },
			{
				name: 'Ancestor and descendant narratives',
				text: 'Generation by generation, numbered Ahnentafel for ancestors and d’Aboville or Henry for descendants.'
			},
			{
				name: 'Relatives list',
				text: 'Everyone related within the generations you choose, with how they are related.'
			},
			{
				name: 'Research gaps',
				text: 'How complete each generation of ancestors is, and the brick walls where a line stops.'
			},
			{ name: 'Evidence summary', text: 'Each claim about the person and the sources behind it.' },
			{
				name: 'Interview sheet',
				text: 'What the tree records and what it is missing, to tick and correct with a relative.'
			},
			{
				name: 'Family book',
				text: 'Ancestors, descendants and research gaps in one book, with contents and an index of names.'
			}
		]
	},
	{
		title: 'About a partnership',
		reports: [
			{
				name: 'Family group sheet',
				text: 'The partners, their parents and their children on one sheet.'
			}
		]
	},
	{
		title: 'Across the tree',
		reports: [
			{ name: 'Source usage', text: 'Every citation of a source and what it supports.' },
			{
				name: 'Place report',
				text: 'The people and events at a place, and at the places within it.'
			},
			{
				name: 'Anniversary calendar',
				text: 'Births, partnerships and deaths by day of the month, also as an iCalendar file.'
			}
		]
	}
];

/** How things print (ADR-080 and the poster commits on `main`). */
export const PRINTING: Report[] = [
	{
		name: 'Any page',
		text: 'Prints without the app’s menus and buttons, black on white, with a footer naming the tree, the day and your role. Chrome 131 and later add page numbers.'
	},
	{
		name: 'Wall charts',
		text: 'A chart prints landscape. On A3 to A0 it is fitted to one sheet; on A4 it keeps its size across several pages.'
	},
	{
		name: 'The family view as a poster',
		text: 'Every card at full detail on one sheet cut to the drawing. Only the short side is held to A0’s 841 mm, so a wide family runs on as a banner for a plotter roll.'
	},
	{
		name: 'PDF and CSV',
		text: 'Download PDF saves the poster at its own size, for print dialogs that only offer the printer’s paper. The source, place and calendar reports download as CSV.'
	}
];

/** The maps page: where places are, and what leaves the install to find them. */
export const MAPS_PAGE = {
	path: '/maps',
	title: 'Places and maps',
	description:
		'Epoch puts a family’s places on an OpenStreetMap map and traces each person’s life across it. Only place text leaves your install, and living people’s homes stay off the map.',
	lede: 'Where the family lived, married and was buried, on a map you do not have to pay for.',
	/** Plain paragraphs; `[text](url)` becomes a link. */
	paragraphs: [
		'A place gets its location from the coordinates in a GEDCOM file, from an OpenStreetMap search, or from a pin dropped on the map. The Places tab shows them all on a map beside the list, and a person’s page traces their life from place to place.',
		'While you type a place, Epoch suggests the tree’s own places first, then OpenStreetMap’s. An [editor](/roles) can set or clear a location, and a manager can run Match places, which looks up every unlocated place and lists the likely matches to accept. Every change to a location can be undone.'
	],
	closeTitle: 'See the demo family’s places.',
	closeAction: 'Open the demo’s map'
};

/** What a place search sends and what it never does (ADR-078 on `main`). */
export const MAP_PRIVACY = {
	sent: [
		'The text of a place, such as “Whitby, Yorkshire”',
		'For Match places, only places of people the living rule treats as dead, or who are public',
		'The map tiles each reader’s browser loads from OpenStreetMap'
	],
	never: [
		'A person, a date or the tree',
		'Text that looks like a street address',
		'Living people’s homes and census entries, which stay off the maps'
	]
} as const;

export const MAPS_NOTE =
	'Epoch uses free OpenStreetMap services only: Leaflet draws the map from OpenStreetMap’s tiles, and Photon answers searches through your own install, which keeps its answers. The install owner can turn searching off or point it at their own Photon server. There is no Google option.';

/** The sentence on the home page that points to the pages below it. `[text](url)` links. */
export const FEATURES_MORE =
	'Read about [reports and printing](/reports) and [places and maps](/maps). Every tree role adds to the one before it: see [who can do what](/roles). A manager can also cut a large tree down to one family line with [sub-trees](/sub-trees).';

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
		question: 'Can I print the tree?',
		answer: [
			'Yes. Every page prints without the app’s menus, and the reports include narratives, a family group sheet and a family book. Charts print as wall charts on A3 to A0, and the family view prints or saves as a PDF poster sized to the drawing. [Reports and printing](/reports).'
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
			'Record pages, lists and the family view have phone layouts, and Epoch installs as a home-screen app with pull to refresh. The 3D views are best on a larger screen.'
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
			'Epoch is young and under active development. Known gaps and planned work, such as timelines, phonetic search and contributor suggestions, are listed in [the backlog](' +
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
