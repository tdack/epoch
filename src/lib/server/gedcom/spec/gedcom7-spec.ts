// GENERATED FILE - DO NOT EDIT.
// Source: https://github.com/FamilySearch/GEDCOM
// Release: v7.0.18, commit 2f0b863b5a42275bd2b3ca315900cf779e42f28b
// Licence: Apache-2.0 (see scripts/gedcom-spec/source/LICENSE and NOTICE)
// Regenerate with `npm run gedcom:spec`; refresh the vendored data with
// `node scripts/gedcom-spec/vendor.mjs <tag>` first.
import type { CalendarSpec, RootRecordSpec, StructureSpec } from './types';

export const GEDCOM7_SPEC_RELEASE = {
	tag: 'v7.0.18',
	commit: '2f0b863b5a42275bd2b3ca315900cf779e42f28b'
} as const;

/** Every structure type, keyed by URI. */
export const GEDCOM7_STRUCTURES = {
	'https://gedcom.io/terms/v7/ABBR': { tag: 'ABBR', payload: { kind: 'string' }, subs: {} },
	'https://gedcom.io/terms/v7/ADDR': {
		tag: 'ADDR',
		payload: { kind: 'string' },
		subs: {
			ADR1: { uri: 'https://gedcom.io/terms/v7/ADR1', min: 0, max: 1 },
			ADR2: { uri: 'https://gedcom.io/terms/v7/ADR2', min: 0, max: 1 },
			ADR3: { uri: 'https://gedcom.io/terms/v7/ADR3', min: 0, max: 1 },
			CITY: { uri: 'https://gedcom.io/terms/v7/CITY', min: 0, max: 1 },
			CTRY: { uri: 'https://gedcom.io/terms/v7/CTRY', min: 0, max: 1 },
			POST: { uri: 'https://gedcom.io/terms/v7/POST', min: 0, max: 1 },
			STAE: { uri: 'https://gedcom.io/terms/v7/STAE', min: 0, max: 1 }
		}
	},
	'https://gedcom.io/terms/v7/ADOP': {
		tag: 'ADOP',
		payload: { kind: 'yOrNull' },
		subs: {
			ADDR: { uri: 'https://gedcom.io/terms/v7/ADDR', min: 0, max: 1 },
			AGE: { uri: 'https://gedcom.io/terms/v7/AGE', min: 0, max: 1 },
			AGNC: { uri: 'https://gedcom.io/terms/v7/AGNC', min: 0, max: 1 },
			ASSO: { uri: 'https://gedcom.io/terms/v7/ASSO', min: 0, max: null },
			CAUS: { uri: 'https://gedcom.io/terms/v7/CAUS', min: 0, max: 1 },
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			EMAIL: { uri: 'https://gedcom.io/terms/v7/EMAIL', min: 0, max: null },
			FAMC: { uri: 'https://gedcom.io/terms/v7/ADOP-FAMC', min: 0, max: 1 },
			FAX: { uri: 'https://gedcom.io/terms/v7/FAX', min: 0, max: null },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			PHON: { uri: 'https://gedcom.io/terms/v7/PHON', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			RELI: { uri: 'https://gedcom.io/terms/v7/RELI', min: 0, max: 1 },
			RESN: { uri: 'https://gedcom.io/terms/v7/RESN', min: 0, max: 1 },
			SDATE: { uri: 'https://gedcom.io/terms/v7/SDATE', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			TYPE: { uri: 'https://gedcom.io/terms/v7/TYPE', min: 0, max: 1 },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WWW: { uri: 'https://gedcom.io/terms/v7/WWW', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/ADOP-FAMC': {
		tag: 'FAMC',
		payload: { kind: 'pointer', target: 'https://gedcom.io/terms/v7/record-FAM' },
		subs: { ADOP: { uri: 'https://gedcom.io/terms/v7/FAMC-ADOP', min: 0, max: 1 } }
	},
	'https://gedcom.io/terms/v7/ADR1': { tag: 'ADR1', payload: { kind: 'string' }, subs: {} },
	'https://gedcom.io/terms/v7/ADR2': { tag: 'ADR2', payload: { kind: 'string' }, subs: {} },
	'https://gedcom.io/terms/v7/ADR3': { tag: 'ADR3', payload: { kind: 'string' }, subs: {} },
	'https://gedcom.io/terms/v7/AGE': {
		tag: 'AGE',
		payload: { kind: 'age' },
		subs: { PHRASE: { uri: 'https://gedcom.io/terms/v7/PHRASE', min: 0, max: 1 } }
	},
	'https://gedcom.io/terms/v7/AGNC': { tag: 'AGNC', payload: { kind: 'string' }, subs: {} },
	'https://gedcom.io/terms/v7/ALIA': {
		tag: 'ALIA',
		payload: { kind: 'pointer', target: 'https://gedcom.io/terms/v7/record-INDI' },
		subs: { PHRASE: { uri: 'https://gedcom.io/terms/v7/PHRASE', min: 0, max: 1 } }
	},
	'https://gedcom.io/terms/v7/ANCI': {
		tag: 'ANCI',
		payload: { kind: 'pointer', target: 'https://gedcom.io/terms/v7/record-SUBM' },
		subs: {}
	},
	'https://gedcom.io/terms/v7/ANUL': {
		tag: 'ANUL',
		payload: { kind: 'yOrNull' },
		subs: {
			ADDR: { uri: 'https://gedcom.io/terms/v7/ADDR', min: 0, max: 1 },
			AGNC: { uri: 'https://gedcom.io/terms/v7/AGNC', min: 0, max: 1 },
			ASSO: { uri: 'https://gedcom.io/terms/v7/ASSO', min: 0, max: null },
			CAUS: { uri: 'https://gedcom.io/terms/v7/CAUS', min: 0, max: 1 },
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			EMAIL: { uri: 'https://gedcom.io/terms/v7/EMAIL', min: 0, max: null },
			FAX: { uri: 'https://gedcom.io/terms/v7/FAX', min: 0, max: null },
			HUSB: { uri: 'https://gedcom.io/terms/v7/HUSB', min: 0, max: 1 },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			PHON: { uri: 'https://gedcom.io/terms/v7/PHON', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			RELI: { uri: 'https://gedcom.io/terms/v7/RELI', min: 0, max: 1 },
			RESN: { uri: 'https://gedcom.io/terms/v7/RESN', min: 0, max: 1 },
			SDATE: { uri: 'https://gedcom.io/terms/v7/SDATE', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			TYPE: { uri: 'https://gedcom.io/terms/v7/TYPE', min: 0, max: 1 },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WIFE: { uri: 'https://gedcom.io/terms/v7/WIFE', min: 0, max: 1 },
			WWW: { uri: 'https://gedcom.io/terms/v7/WWW', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/ASSO': {
		tag: 'ASSO',
		payload: { kind: 'pointer', target: 'https://gedcom.io/terms/v7/record-INDI' },
		subs: {
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			PHRASE: { uri: 'https://gedcom.io/terms/v7/PHRASE', min: 0, max: 1 },
			ROLE: { uri: 'https://gedcom.io/terms/v7/ROLE', min: 1, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/AUTH': { tag: 'AUTH', payload: { kind: 'string' }, subs: {} },
	'https://gedcom.io/terms/v7/BAPL': {
		tag: 'BAPL',
		payload: { kind: 'none' },
		subs: {
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			STAT: { uri: 'https://gedcom.io/terms/v7/ord-STAT', min: 0, max: 1 },
			TEMP: { uri: 'https://gedcom.io/terms/v7/TEMP', min: 0, max: 1 }
		}
	},
	'https://gedcom.io/terms/v7/BAPM': {
		tag: 'BAPM',
		payload: { kind: 'yOrNull' },
		subs: {
			ADDR: { uri: 'https://gedcom.io/terms/v7/ADDR', min: 0, max: 1 },
			AGE: { uri: 'https://gedcom.io/terms/v7/AGE', min: 0, max: 1 },
			AGNC: { uri: 'https://gedcom.io/terms/v7/AGNC', min: 0, max: 1 },
			ASSO: { uri: 'https://gedcom.io/terms/v7/ASSO', min: 0, max: null },
			CAUS: { uri: 'https://gedcom.io/terms/v7/CAUS', min: 0, max: 1 },
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			EMAIL: { uri: 'https://gedcom.io/terms/v7/EMAIL', min: 0, max: null },
			FAX: { uri: 'https://gedcom.io/terms/v7/FAX', min: 0, max: null },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			PHON: { uri: 'https://gedcom.io/terms/v7/PHON', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			RELI: { uri: 'https://gedcom.io/terms/v7/RELI', min: 0, max: 1 },
			RESN: { uri: 'https://gedcom.io/terms/v7/RESN', min: 0, max: 1 },
			SDATE: { uri: 'https://gedcom.io/terms/v7/SDATE', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			TYPE: { uri: 'https://gedcom.io/terms/v7/TYPE', min: 0, max: 1 },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WWW: { uri: 'https://gedcom.io/terms/v7/WWW', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/BARM': {
		tag: 'BARM',
		payload: { kind: 'yOrNull' },
		subs: {
			ADDR: { uri: 'https://gedcom.io/terms/v7/ADDR', min: 0, max: 1 },
			AGE: { uri: 'https://gedcom.io/terms/v7/AGE', min: 0, max: 1 },
			AGNC: { uri: 'https://gedcom.io/terms/v7/AGNC', min: 0, max: 1 },
			ASSO: { uri: 'https://gedcom.io/terms/v7/ASSO', min: 0, max: null },
			CAUS: { uri: 'https://gedcom.io/terms/v7/CAUS', min: 0, max: 1 },
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			EMAIL: { uri: 'https://gedcom.io/terms/v7/EMAIL', min: 0, max: null },
			FAX: { uri: 'https://gedcom.io/terms/v7/FAX', min: 0, max: null },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			PHON: { uri: 'https://gedcom.io/terms/v7/PHON', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			RELI: { uri: 'https://gedcom.io/terms/v7/RELI', min: 0, max: 1 },
			RESN: { uri: 'https://gedcom.io/terms/v7/RESN', min: 0, max: 1 },
			SDATE: { uri: 'https://gedcom.io/terms/v7/SDATE', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			TYPE: { uri: 'https://gedcom.io/terms/v7/TYPE', min: 0, max: 1 },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WWW: { uri: 'https://gedcom.io/terms/v7/WWW', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/BASM': {
		tag: 'BASM',
		payload: { kind: 'yOrNull' },
		subs: {
			ADDR: { uri: 'https://gedcom.io/terms/v7/ADDR', min: 0, max: 1 },
			AGE: { uri: 'https://gedcom.io/terms/v7/AGE', min: 0, max: 1 },
			AGNC: { uri: 'https://gedcom.io/terms/v7/AGNC', min: 0, max: 1 },
			ASSO: { uri: 'https://gedcom.io/terms/v7/ASSO', min: 0, max: null },
			CAUS: { uri: 'https://gedcom.io/terms/v7/CAUS', min: 0, max: 1 },
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			EMAIL: { uri: 'https://gedcom.io/terms/v7/EMAIL', min: 0, max: null },
			FAX: { uri: 'https://gedcom.io/terms/v7/FAX', min: 0, max: null },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			PHON: { uri: 'https://gedcom.io/terms/v7/PHON', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			RELI: { uri: 'https://gedcom.io/terms/v7/RELI', min: 0, max: 1 },
			RESN: { uri: 'https://gedcom.io/terms/v7/RESN', min: 0, max: 1 },
			SDATE: { uri: 'https://gedcom.io/terms/v7/SDATE', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			TYPE: { uri: 'https://gedcom.io/terms/v7/TYPE', min: 0, max: 1 },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WWW: { uri: 'https://gedcom.io/terms/v7/WWW', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/BIRT': {
		tag: 'BIRT',
		payload: { kind: 'yOrNull' },
		subs: {
			ADDR: { uri: 'https://gedcom.io/terms/v7/ADDR', min: 0, max: 1 },
			AGE: { uri: 'https://gedcom.io/terms/v7/AGE', min: 0, max: 1 },
			AGNC: { uri: 'https://gedcom.io/terms/v7/AGNC', min: 0, max: 1 },
			ASSO: { uri: 'https://gedcom.io/terms/v7/ASSO', min: 0, max: null },
			CAUS: { uri: 'https://gedcom.io/terms/v7/CAUS', min: 0, max: 1 },
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			EMAIL: { uri: 'https://gedcom.io/terms/v7/EMAIL', min: 0, max: null },
			FAMC: { uri: 'https://gedcom.io/terms/v7/FAMC', min: 0, max: 1 },
			FAX: { uri: 'https://gedcom.io/terms/v7/FAX', min: 0, max: null },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			PHON: { uri: 'https://gedcom.io/terms/v7/PHON', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			RELI: { uri: 'https://gedcom.io/terms/v7/RELI', min: 0, max: 1 },
			RESN: { uri: 'https://gedcom.io/terms/v7/RESN', min: 0, max: 1 },
			SDATE: { uri: 'https://gedcom.io/terms/v7/SDATE', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			TYPE: { uri: 'https://gedcom.io/terms/v7/TYPE', min: 0, max: 1 },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WWW: { uri: 'https://gedcom.io/terms/v7/WWW', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/BLES': {
		tag: 'BLES',
		payload: { kind: 'yOrNull' },
		subs: {
			ADDR: { uri: 'https://gedcom.io/terms/v7/ADDR', min: 0, max: 1 },
			AGE: { uri: 'https://gedcom.io/terms/v7/AGE', min: 0, max: 1 },
			AGNC: { uri: 'https://gedcom.io/terms/v7/AGNC', min: 0, max: 1 },
			ASSO: { uri: 'https://gedcom.io/terms/v7/ASSO', min: 0, max: null },
			CAUS: { uri: 'https://gedcom.io/terms/v7/CAUS', min: 0, max: 1 },
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			EMAIL: { uri: 'https://gedcom.io/terms/v7/EMAIL', min: 0, max: null },
			FAX: { uri: 'https://gedcom.io/terms/v7/FAX', min: 0, max: null },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			PHON: { uri: 'https://gedcom.io/terms/v7/PHON', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			RELI: { uri: 'https://gedcom.io/terms/v7/RELI', min: 0, max: 1 },
			RESN: { uri: 'https://gedcom.io/terms/v7/RESN', min: 0, max: 1 },
			SDATE: { uri: 'https://gedcom.io/terms/v7/SDATE', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			TYPE: { uri: 'https://gedcom.io/terms/v7/TYPE', min: 0, max: 1 },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WWW: { uri: 'https://gedcom.io/terms/v7/WWW', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/BURI': {
		tag: 'BURI',
		payload: { kind: 'yOrNull' },
		subs: {
			ADDR: { uri: 'https://gedcom.io/terms/v7/ADDR', min: 0, max: 1 },
			AGE: { uri: 'https://gedcom.io/terms/v7/AGE', min: 0, max: 1 },
			AGNC: { uri: 'https://gedcom.io/terms/v7/AGNC', min: 0, max: 1 },
			ASSO: { uri: 'https://gedcom.io/terms/v7/ASSO', min: 0, max: null },
			CAUS: { uri: 'https://gedcom.io/terms/v7/CAUS', min: 0, max: 1 },
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			EMAIL: { uri: 'https://gedcom.io/terms/v7/EMAIL', min: 0, max: null },
			FAX: { uri: 'https://gedcom.io/terms/v7/FAX', min: 0, max: null },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			PHON: { uri: 'https://gedcom.io/terms/v7/PHON', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			RELI: { uri: 'https://gedcom.io/terms/v7/RELI', min: 0, max: 1 },
			RESN: { uri: 'https://gedcom.io/terms/v7/RESN', min: 0, max: 1 },
			SDATE: { uri: 'https://gedcom.io/terms/v7/SDATE', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			TYPE: { uri: 'https://gedcom.io/terms/v7/TYPE', min: 0, max: 1 },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WWW: { uri: 'https://gedcom.io/terms/v7/WWW', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/CALN': {
		tag: 'CALN',
		payload: { kind: 'string' },
		subs: { MEDI: { uri: 'https://gedcom.io/terms/v7/MEDI', min: 0, max: 1 } }
	},
	'https://gedcom.io/terms/v7/CAST': {
		tag: 'CAST',
		payload: { kind: 'string' },
		subs: {
			ADDR: { uri: 'https://gedcom.io/terms/v7/ADDR', min: 0, max: 1 },
			AGE: { uri: 'https://gedcom.io/terms/v7/AGE', min: 0, max: 1 },
			AGNC: { uri: 'https://gedcom.io/terms/v7/AGNC', min: 0, max: 1 },
			ASSO: { uri: 'https://gedcom.io/terms/v7/ASSO', min: 0, max: null },
			CAUS: { uri: 'https://gedcom.io/terms/v7/CAUS', min: 0, max: 1 },
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			EMAIL: { uri: 'https://gedcom.io/terms/v7/EMAIL', min: 0, max: null },
			FAX: { uri: 'https://gedcom.io/terms/v7/FAX', min: 0, max: null },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			PHON: { uri: 'https://gedcom.io/terms/v7/PHON', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			RELI: { uri: 'https://gedcom.io/terms/v7/RELI', min: 0, max: 1 },
			RESN: { uri: 'https://gedcom.io/terms/v7/RESN', min: 0, max: 1 },
			SDATE: { uri: 'https://gedcom.io/terms/v7/SDATE', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			TYPE: { uri: 'https://gedcom.io/terms/v7/TYPE', min: 0, max: 1 },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WWW: { uri: 'https://gedcom.io/terms/v7/WWW', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/CAUS': { tag: 'CAUS', payload: { kind: 'string' }, subs: {} },
	'https://gedcom.io/terms/v7/CHAN': {
		tag: 'CHAN',
		payload: { kind: 'none' },
		subs: {
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE-exact', min: 1, max: 1 },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/CHIL': {
		tag: 'CHIL',
		payload: { kind: 'pointer', target: 'https://gedcom.io/terms/v7/record-INDI' },
		subs: { PHRASE: { uri: 'https://gedcom.io/terms/v7/PHRASE', min: 0, max: 1 } }
	},
	'https://gedcom.io/terms/v7/CHR': {
		tag: 'CHR',
		payload: { kind: 'yOrNull' },
		subs: {
			ADDR: { uri: 'https://gedcom.io/terms/v7/ADDR', min: 0, max: 1 },
			AGE: { uri: 'https://gedcom.io/terms/v7/AGE', min: 0, max: 1 },
			AGNC: { uri: 'https://gedcom.io/terms/v7/AGNC', min: 0, max: 1 },
			ASSO: { uri: 'https://gedcom.io/terms/v7/ASSO', min: 0, max: null },
			CAUS: { uri: 'https://gedcom.io/terms/v7/CAUS', min: 0, max: 1 },
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			EMAIL: { uri: 'https://gedcom.io/terms/v7/EMAIL', min: 0, max: null },
			FAMC: { uri: 'https://gedcom.io/terms/v7/FAMC', min: 0, max: 1 },
			FAX: { uri: 'https://gedcom.io/terms/v7/FAX', min: 0, max: null },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			PHON: { uri: 'https://gedcom.io/terms/v7/PHON', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			RELI: { uri: 'https://gedcom.io/terms/v7/RELI', min: 0, max: 1 },
			RESN: { uri: 'https://gedcom.io/terms/v7/RESN', min: 0, max: 1 },
			SDATE: { uri: 'https://gedcom.io/terms/v7/SDATE', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			TYPE: { uri: 'https://gedcom.io/terms/v7/TYPE', min: 0, max: 1 },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WWW: { uri: 'https://gedcom.io/terms/v7/WWW', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/CHRA': {
		tag: 'CHRA',
		payload: { kind: 'yOrNull' },
		subs: {
			ADDR: { uri: 'https://gedcom.io/terms/v7/ADDR', min: 0, max: 1 },
			AGE: { uri: 'https://gedcom.io/terms/v7/AGE', min: 0, max: 1 },
			AGNC: { uri: 'https://gedcom.io/terms/v7/AGNC', min: 0, max: 1 },
			ASSO: { uri: 'https://gedcom.io/terms/v7/ASSO', min: 0, max: null },
			CAUS: { uri: 'https://gedcom.io/terms/v7/CAUS', min: 0, max: 1 },
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			EMAIL: { uri: 'https://gedcom.io/terms/v7/EMAIL', min: 0, max: null },
			FAX: { uri: 'https://gedcom.io/terms/v7/FAX', min: 0, max: null },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			PHON: { uri: 'https://gedcom.io/terms/v7/PHON', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			RELI: { uri: 'https://gedcom.io/terms/v7/RELI', min: 0, max: 1 },
			RESN: { uri: 'https://gedcom.io/terms/v7/RESN', min: 0, max: 1 },
			SDATE: { uri: 'https://gedcom.io/terms/v7/SDATE', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			TYPE: { uri: 'https://gedcom.io/terms/v7/TYPE', min: 0, max: 1 },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WWW: { uri: 'https://gedcom.io/terms/v7/WWW', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/CITY': { tag: 'CITY', payload: { kind: 'string' }, subs: {} },
	'https://gedcom.io/terms/v7/CONF': {
		tag: 'CONF',
		payload: { kind: 'yOrNull' },
		subs: {
			ADDR: { uri: 'https://gedcom.io/terms/v7/ADDR', min: 0, max: 1 },
			AGE: { uri: 'https://gedcom.io/terms/v7/AGE', min: 0, max: 1 },
			AGNC: { uri: 'https://gedcom.io/terms/v7/AGNC', min: 0, max: 1 },
			ASSO: { uri: 'https://gedcom.io/terms/v7/ASSO', min: 0, max: null },
			CAUS: { uri: 'https://gedcom.io/terms/v7/CAUS', min: 0, max: 1 },
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			EMAIL: { uri: 'https://gedcom.io/terms/v7/EMAIL', min: 0, max: null },
			FAX: { uri: 'https://gedcom.io/terms/v7/FAX', min: 0, max: null },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			PHON: { uri: 'https://gedcom.io/terms/v7/PHON', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			RELI: { uri: 'https://gedcom.io/terms/v7/RELI', min: 0, max: 1 },
			RESN: { uri: 'https://gedcom.io/terms/v7/RESN', min: 0, max: 1 },
			SDATE: { uri: 'https://gedcom.io/terms/v7/SDATE', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			TYPE: { uri: 'https://gedcom.io/terms/v7/TYPE', min: 0, max: 1 },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WWW: { uri: 'https://gedcom.io/terms/v7/WWW', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/CONL': {
		tag: 'CONL',
		payload: { kind: 'none' },
		subs: {
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			STAT: { uri: 'https://gedcom.io/terms/v7/ord-STAT', min: 0, max: 1 },
			TEMP: { uri: 'https://gedcom.io/terms/v7/TEMP', min: 0, max: 1 }
		}
	},
	'https://gedcom.io/terms/v7/CONT': { tag: 'CONT', payload: { kind: 'none' }, subs: {} },
	'https://gedcom.io/terms/v7/COPR': { tag: 'COPR', payload: { kind: 'string' }, subs: {} },
	'https://gedcom.io/terms/v7/CORP': {
		tag: 'CORP',
		payload: { kind: 'string' },
		subs: {
			ADDR: { uri: 'https://gedcom.io/terms/v7/ADDR', min: 0, max: 1 },
			EMAIL: { uri: 'https://gedcom.io/terms/v7/EMAIL', min: 0, max: null },
			FAX: { uri: 'https://gedcom.io/terms/v7/FAX', min: 0, max: null },
			PHON: { uri: 'https://gedcom.io/terms/v7/PHON', min: 0, max: null },
			WWW: { uri: 'https://gedcom.io/terms/v7/WWW', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/CREA': {
		tag: 'CREA',
		payload: { kind: 'none' },
		subs: { DATE: { uri: 'https://gedcom.io/terms/v7/DATE-exact', min: 1, max: 1 } }
	},
	'https://gedcom.io/terms/v7/CREM': {
		tag: 'CREM',
		payload: { kind: 'yOrNull' },
		subs: {
			ADDR: { uri: 'https://gedcom.io/terms/v7/ADDR', min: 0, max: 1 },
			AGE: { uri: 'https://gedcom.io/terms/v7/AGE', min: 0, max: 1 },
			AGNC: { uri: 'https://gedcom.io/terms/v7/AGNC', min: 0, max: 1 },
			ASSO: { uri: 'https://gedcom.io/terms/v7/ASSO', min: 0, max: null },
			CAUS: { uri: 'https://gedcom.io/terms/v7/CAUS', min: 0, max: 1 },
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			EMAIL: { uri: 'https://gedcom.io/terms/v7/EMAIL', min: 0, max: null },
			FAX: { uri: 'https://gedcom.io/terms/v7/FAX', min: 0, max: null },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			PHON: { uri: 'https://gedcom.io/terms/v7/PHON', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			RELI: { uri: 'https://gedcom.io/terms/v7/RELI', min: 0, max: 1 },
			RESN: { uri: 'https://gedcom.io/terms/v7/RESN', min: 0, max: 1 },
			SDATE: { uri: 'https://gedcom.io/terms/v7/SDATE', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			TYPE: { uri: 'https://gedcom.io/terms/v7/TYPE', min: 0, max: 1 },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WWW: { uri: 'https://gedcom.io/terms/v7/WWW', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/CROP': {
		tag: 'CROP',
		payload: { kind: 'none' },
		subs: {
			HEIGHT: { uri: 'https://gedcom.io/terms/v7/HEIGHT', min: 0, max: 1 },
			LEFT: { uri: 'https://gedcom.io/terms/v7/LEFT', min: 0, max: 1 },
			TOP: { uri: 'https://gedcom.io/terms/v7/TOP', min: 0, max: 1 },
			WIDTH: { uri: 'https://gedcom.io/terms/v7/WIDTH', min: 0, max: 1 }
		}
	},
	'https://gedcom.io/terms/v7/CTRY': { tag: 'CTRY', payload: { kind: 'string' }, subs: {} },
	'https://gedcom.io/terms/v7/DATA': {
		tag: 'DATA',
		payload: { kind: 'none' },
		subs: {
			AGNC: { uri: 'https://gedcom.io/terms/v7/AGNC', min: 0, max: 1 },
			EVEN: { uri: 'https://gedcom.io/terms/v7/DATA-EVEN', min: 0, max: null },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/DATA-EVEN': {
		tag: 'EVEN',
		payload: { kind: 'listEnum', enumSet: 'https://gedcom.io/terms/v7/enumset-EVENATTR' },
		subs: {
			DATE: { uri: 'https://gedcom.io/terms/v7/DATA-EVEN-DATE', min: 0, max: 1 },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 }
		}
	},
	'https://gedcom.io/terms/v7/DATA-EVEN-DATE': {
		tag: 'DATE',
		payload: { kind: 'datePeriod' },
		subs: { PHRASE: { uri: 'https://gedcom.io/terms/v7/PHRASE', min: 0, max: 1 } }
	},
	'https://gedcom.io/terms/v7/DATE': {
		tag: 'DATE',
		payload: { kind: 'dateValue' },
		subs: {
			PHRASE: { uri: 'https://gedcom.io/terms/v7/PHRASE', min: 0, max: 1 },
			TIME: { uri: 'https://gedcom.io/terms/v7/TIME', min: 0, max: 1 }
		}
	},
	'https://gedcom.io/terms/v7/DATE-exact': {
		tag: 'DATE',
		payload: { kind: 'dateExact' },
		subs: { TIME: { uri: 'https://gedcom.io/terms/v7/TIME', min: 0, max: 1 } }
	},
	'https://gedcom.io/terms/v7/DEAT': {
		tag: 'DEAT',
		payload: { kind: 'yOrNull' },
		subs: {
			ADDR: { uri: 'https://gedcom.io/terms/v7/ADDR', min: 0, max: 1 },
			AGE: { uri: 'https://gedcom.io/terms/v7/AGE', min: 0, max: 1 },
			AGNC: { uri: 'https://gedcom.io/terms/v7/AGNC', min: 0, max: 1 },
			ASSO: { uri: 'https://gedcom.io/terms/v7/ASSO', min: 0, max: null },
			CAUS: { uri: 'https://gedcom.io/terms/v7/CAUS', min: 0, max: 1 },
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			EMAIL: { uri: 'https://gedcom.io/terms/v7/EMAIL', min: 0, max: null },
			FAX: { uri: 'https://gedcom.io/terms/v7/FAX', min: 0, max: null },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			PHON: { uri: 'https://gedcom.io/terms/v7/PHON', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			RELI: { uri: 'https://gedcom.io/terms/v7/RELI', min: 0, max: 1 },
			RESN: { uri: 'https://gedcom.io/terms/v7/RESN', min: 0, max: 1 },
			SDATE: { uri: 'https://gedcom.io/terms/v7/SDATE', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			TYPE: { uri: 'https://gedcom.io/terms/v7/TYPE', min: 0, max: 1 },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WWW: { uri: 'https://gedcom.io/terms/v7/WWW', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/DESI': {
		tag: 'DESI',
		payload: { kind: 'pointer', target: 'https://gedcom.io/terms/v7/record-SUBM' },
		subs: {}
	},
	'https://gedcom.io/terms/v7/DEST': { tag: 'DEST', payload: { kind: 'string' }, subs: {} },
	'https://gedcom.io/terms/v7/DIV': {
		tag: 'DIV',
		payload: { kind: 'yOrNull' },
		subs: {
			ADDR: { uri: 'https://gedcom.io/terms/v7/ADDR', min: 0, max: 1 },
			AGNC: { uri: 'https://gedcom.io/terms/v7/AGNC', min: 0, max: 1 },
			ASSO: { uri: 'https://gedcom.io/terms/v7/ASSO', min: 0, max: null },
			CAUS: { uri: 'https://gedcom.io/terms/v7/CAUS', min: 0, max: 1 },
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			EMAIL: { uri: 'https://gedcom.io/terms/v7/EMAIL', min: 0, max: null },
			FAX: { uri: 'https://gedcom.io/terms/v7/FAX', min: 0, max: null },
			HUSB: { uri: 'https://gedcom.io/terms/v7/HUSB', min: 0, max: 1 },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			PHON: { uri: 'https://gedcom.io/terms/v7/PHON', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			RELI: { uri: 'https://gedcom.io/terms/v7/RELI', min: 0, max: 1 },
			RESN: { uri: 'https://gedcom.io/terms/v7/RESN', min: 0, max: 1 },
			SDATE: { uri: 'https://gedcom.io/terms/v7/SDATE', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			TYPE: { uri: 'https://gedcom.io/terms/v7/TYPE', min: 0, max: 1 },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WIFE: { uri: 'https://gedcom.io/terms/v7/WIFE', min: 0, max: 1 },
			WWW: { uri: 'https://gedcom.io/terms/v7/WWW', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/DIVF': {
		tag: 'DIVF',
		payload: { kind: 'yOrNull' },
		subs: {
			ADDR: { uri: 'https://gedcom.io/terms/v7/ADDR', min: 0, max: 1 },
			AGNC: { uri: 'https://gedcom.io/terms/v7/AGNC', min: 0, max: 1 },
			ASSO: { uri: 'https://gedcom.io/terms/v7/ASSO', min: 0, max: null },
			CAUS: { uri: 'https://gedcom.io/terms/v7/CAUS', min: 0, max: 1 },
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			EMAIL: { uri: 'https://gedcom.io/terms/v7/EMAIL', min: 0, max: null },
			FAX: { uri: 'https://gedcom.io/terms/v7/FAX', min: 0, max: null },
			HUSB: { uri: 'https://gedcom.io/terms/v7/HUSB', min: 0, max: 1 },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			PHON: { uri: 'https://gedcom.io/terms/v7/PHON', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			RELI: { uri: 'https://gedcom.io/terms/v7/RELI', min: 0, max: 1 },
			RESN: { uri: 'https://gedcom.io/terms/v7/RESN', min: 0, max: 1 },
			SDATE: { uri: 'https://gedcom.io/terms/v7/SDATE', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			TYPE: { uri: 'https://gedcom.io/terms/v7/TYPE', min: 0, max: 1 },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WIFE: { uri: 'https://gedcom.io/terms/v7/WIFE', min: 0, max: 1 },
			WWW: { uri: 'https://gedcom.io/terms/v7/WWW', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/DSCR': {
		tag: 'DSCR',
		payload: { kind: 'string' },
		subs: {
			ADDR: { uri: 'https://gedcom.io/terms/v7/ADDR', min: 0, max: 1 },
			AGE: { uri: 'https://gedcom.io/terms/v7/AGE', min: 0, max: 1 },
			AGNC: { uri: 'https://gedcom.io/terms/v7/AGNC', min: 0, max: 1 },
			ASSO: { uri: 'https://gedcom.io/terms/v7/ASSO', min: 0, max: null },
			CAUS: { uri: 'https://gedcom.io/terms/v7/CAUS', min: 0, max: 1 },
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			EMAIL: { uri: 'https://gedcom.io/terms/v7/EMAIL', min: 0, max: null },
			FAX: { uri: 'https://gedcom.io/terms/v7/FAX', min: 0, max: null },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			PHON: { uri: 'https://gedcom.io/terms/v7/PHON', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			RELI: { uri: 'https://gedcom.io/terms/v7/RELI', min: 0, max: 1 },
			RESN: { uri: 'https://gedcom.io/terms/v7/RESN', min: 0, max: 1 },
			SDATE: { uri: 'https://gedcom.io/terms/v7/SDATE', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			TYPE: { uri: 'https://gedcom.io/terms/v7/TYPE', min: 0, max: 1 },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WWW: { uri: 'https://gedcom.io/terms/v7/WWW', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/EDUC': {
		tag: 'EDUC',
		payload: { kind: 'string' },
		subs: {
			ADDR: { uri: 'https://gedcom.io/terms/v7/ADDR', min: 0, max: 1 },
			AGE: { uri: 'https://gedcom.io/terms/v7/AGE', min: 0, max: 1 },
			AGNC: { uri: 'https://gedcom.io/terms/v7/AGNC', min: 0, max: 1 },
			ASSO: { uri: 'https://gedcom.io/terms/v7/ASSO', min: 0, max: null },
			CAUS: { uri: 'https://gedcom.io/terms/v7/CAUS', min: 0, max: 1 },
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			EMAIL: { uri: 'https://gedcom.io/terms/v7/EMAIL', min: 0, max: null },
			FAX: { uri: 'https://gedcom.io/terms/v7/FAX', min: 0, max: null },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			PHON: { uri: 'https://gedcom.io/terms/v7/PHON', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			RELI: { uri: 'https://gedcom.io/terms/v7/RELI', min: 0, max: 1 },
			RESN: { uri: 'https://gedcom.io/terms/v7/RESN', min: 0, max: 1 },
			SDATE: { uri: 'https://gedcom.io/terms/v7/SDATE', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			TYPE: { uri: 'https://gedcom.io/terms/v7/TYPE', min: 0, max: 1 },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WWW: { uri: 'https://gedcom.io/terms/v7/WWW', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/EMAIL': { tag: 'EMAIL', payload: { kind: 'string' }, subs: {} },
	'https://gedcom.io/terms/v7/EMIG': {
		tag: 'EMIG',
		payload: { kind: 'yOrNull' },
		subs: {
			ADDR: { uri: 'https://gedcom.io/terms/v7/ADDR', min: 0, max: 1 },
			AGE: { uri: 'https://gedcom.io/terms/v7/AGE', min: 0, max: 1 },
			AGNC: { uri: 'https://gedcom.io/terms/v7/AGNC', min: 0, max: 1 },
			ASSO: { uri: 'https://gedcom.io/terms/v7/ASSO', min: 0, max: null },
			CAUS: { uri: 'https://gedcom.io/terms/v7/CAUS', min: 0, max: 1 },
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			EMAIL: { uri: 'https://gedcom.io/terms/v7/EMAIL', min: 0, max: null },
			FAX: { uri: 'https://gedcom.io/terms/v7/FAX', min: 0, max: null },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			PHON: { uri: 'https://gedcom.io/terms/v7/PHON', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			RELI: { uri: 'https://gedcom.io/terms/v7/RELI', min: 0, max: 1 },
			RESN: { uri: 'https://gedcom.io/terms/v7/RESN', min: 0, max: 1 },
			SDATE: { uri: 'https://gedcom.io/terms/v7/SDATE', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			TYPE: { uri: 'https://gedcom.io/terms/v7/TYPE', min: 0, max: 1 },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WWW: { uri: 'https://gedcom.io/terms/v7/WWW', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/ENDL': {
		tag: 'ENDL',
		payload: { kind: 'none' },
		subs: {
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			STAT: { uri: 'https://gedcom.io/terms/v7/ord-STAT', min: 0, max: 1 },
			TEMP: { uri: 'https://gedcom.io/terms/v7/TEMP', min: 0, max: 1 }
		}
	},
	'https://gedcom.io/terms/v7/ENGA': {
		tag: 'ENGA',
		payload: { kind: 'yOrNull' },
		subs: {
			ADDR: { uri: 'https://gedcom.io/terms/v7/ADDR', min: 0, max: 1 },
			AGNC: { uri: 'https://gedcom.io/terms/v7/AGNC', min: 0, max: 1 },
			ASSO: { uri: 'https://gedcom.io/terms/v7/ASSO', min: 0, max: null },
			CAUS: { uri: 'https://gedcom.io/terms/v7/CAUS', min: 0, max: 1 },
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			EMAIL: { uri: 'https://gedcom.io/terms/v7/EMAIL', min: 0, max: null },
			FAX: { uri: 'https://gedcom.io/terms/v7/FAX', min: 0, max: null },
			HUSB: { uri: 'https://gedcom.io/terms/v7/HUSB', min: 0, max: 1 },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			PHON: { uri: 'https://gedcom.io/terms/v7/PHON', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			RELI: { uri: 'https://gedcom.io/terms/v7/RELI', min: 0, max: 1 },
			RESN: { uri: 'https://gedcom.io/terms/v7/RESN', min: 0, max: 1 },
			SDATE: { uri: 'https://gedcom.io/terms/v7/SDATE', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			TYPE: { uri: 'https://gedcom.io/terms/v7/TYPE', min: 0, max: 1 },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WIFE: { uri: 'https://gedcom.io/terms/v7/WIFE', min: 0, max: 1 },
			WWW: { uri: 'https://gedcom.io/terms/v7/WWW', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/EXID': {
		tag: 'EXID',
		payload: { kind: 'string' },
		subs: { TYPE: { uri: 'https://gedcom.io/terms/v7/EXID-TYPE', min: 0, max: 1 } }
	},
	'https://gedcom.io/terms/v7/EXID-TYPE': { tag: 'TYPE', payload: { kind: 'uri' }, subs: {} },
	'https://gedcom.io/terms/v7/FAM-CENS': {
		tag: 'CENS',
		payload: { kind: 'yOrNull' },
		subs: {
			ADDR: { uri: 'https://gedcom.io/terms/v7/ADDR', min: 0, max: 1 },
			AGNC: { uri: 'https://gedcom.io/terms/v7/AGNC', min: 0, max: 1 },
			ASSO: { uri: 'https://gedcom.io/terms/v7/ASSO', min: 0, max: null },
			CAUS: { uri: 'https://gedcom.io/terms/v7/CAUS', min: 0, max: 1 },
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			EMAIL: { uri: 'https://gedcom.io/terms/v7/EMAIL', min: 0, max: null },
			FAX: { uri: 'https://gedcom.io/terms/v7/FAX', min: 0, max: null },
			HUSB: { uri: 'https://gedcom.io/terms/v7/HUSB', min: 0, max: 1 },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			PHON: { uri: 'https://gedcom.io/terms/v7/PHON', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			RELI: { uri: 'https://gedcom.io/terms/v7/RELI', min: 0, max: 1 },
			RESN: { uri: 'https://gedcom.io/terms/v7/RESN', min: 0, max: 1 },
			SDATE: { uri: 'https://gedcom.io/terms/v7/SDATE', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			TYPE: { uri: 'https://gedcom.io/terms/v7/TYPE', min: 0, max: 1 },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WIFE: { uri: 'https://gedcom.io/terms/v7/WIFE', min: 0, max: 1 },
			WWW: { uri: 'https://gedcom.io/terms/v7/WWW', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/FAM-EVEN': {
		tag: 'EVEN',
		payload: { kind: 'string' },
		subs: {
			ADDR: { uri: 'https://gedcom.io/terms/v7/ADDR', min: 0, max: 1 },
			AGNC: { uri: 'https://gedcom.io/terms/v7/AGNC', min: 0, max: 1 },
			ASSO: { uri: 'https://gedcom.io/terms/v7/ASSO', min: 0, max: null },
			CAUS: { uri: 'https://gedcom.io/terms/v7/CAUS', min: 0, max: 1 },
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			EMAIL: { uri: 'https://gedcom.io/terms/v7/EMAIL', min: 0, max: null },
			FAX: { uri: 'https://gedcom.io/terms/v7/FAX', min: 0, max: null },
			HUSB: { uri: 'https://gedcom.io/terms/v7/HUSB', min: 0, max: 1 },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			PHON: { uri: 'https://gedcom.io/terms/v7/PHON', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			RELI: { uri: 'https://gedcom.io/terms/v7/RELI', min: 0, max: 1 },
			RESN: { uri: 'https://gedcom.io/terms/v7/RESN', min: 0, max: 1 },
			SDATE: { uri: 'https://gedcom.io/terms/v7/SDATE', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			TYPE: { uri: 'https://gedcom.io/terms/v7/TYPE', min: 1, max: 1 },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WIFE: { uri: 'https://gedcom.io/terms/v7/WIFE', min: 0, max: 1 },
			WWW: { uri: 'https://gedcom.io/terms/v7/WWW', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/FAM-FACT': {
		tag: 'FACT',
		payload: { kind: 'string' },
		subs: {
			ADDR: { uri: 'https://gedcom.io/terms/v7/ADDR', min: 0, max: 1 },
			AGNC: { uri: 'https://gedcom.io/terms/v7/AGNC', min: 0, max: 1 },
			ASSO: { uri: 'https://gedcom.io/terms/v7/ASSO', min: 0, max: null },
			CAUS: { uri: 'https://gedcom.io/terms/v7/CAUS', min: 0, max: 1 },
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			EMAIL: { uri: 'https://gedcom.io/terms/v7/EMAIL', min: 0, max: null },
			FAX: { uri: 'https://gedcom.io/terms/v7/FAX', min: 0, max: null },
			HUSB: { uri: 'https://gedcom.io/terms/v7/HUSB', min: 0, max: 1 },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			PHON: { uri: 'https://gedcom.io/terms/v7/PHON', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			RELI: { uri: 'https://gedcom.io/terms/v7/RELI', min: 0, max: 1 },
			RESN: { uri: 'https://gedcom.io/terms/v7/RESN', min: 0, max: 1 },
			SDATE: { uri: 'https://gedcom.io/terms/v7/SDATE', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			TYPE: { uri: 'https://gedcom.io/terms/v7/TYPE', min: 1, max: 1 },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WIFE: { uri: 'https://gedcom.io/terms/v7/WIFE', min: 0, max: 1 },
			WWW: { uri: 'https://gedcom.io/terms/v7/WWW', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/FAM-HUSB': {
		tag: 'HUSB',
		payload: { kind: 'pointer', target: 'https://gedcom.io/terms/v7/record-INDI' },
		subs: { PHRASE: { uri: 'https://gedcom.io/terms/v7/PHRASE', min: 0, max: 1 } }
	},
	'https://gedcom.io/terms/v7/FAM-NCHI': {
		tag: 'NCHI',
		payload: { kind: 'integer' },
		subs: {
			ADDR: { uri: 'https://gedcom.io/terms/v7/ADDR', min: 0, max: 1 },
			AGNC: { uri: 'https://gedcom.io/terms/v7/AGNC', min: 0, max: 1 },
			ASSO: { uri: 'https://gedcom.io/terms/v7/ASSO', min: 0, max: null },
			CAUS: { uri: 'https://gedcom.io/terms/v7/CAUS', min: 0, max: 1 },
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			EMAIL: { uri: 'https://gedcom.io/terms/v7/EMAIL', min: 0, max: null },
			FAX: { uri: 'https://gedcom.io/terms/v7/FAX', min: 0, max: null },
			HUSB: { uri: 'https://gedcom.io/terms/v7/HUSB', min: 0, max: 1 },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			PHON: { uri: 'https://gedcom.io/terms/v7/PHON', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			RELI: { uri: 'https://gedcom.io/terms/v7/RELI', min: 0, max: 1 },
			RESN: { uri: 'https://gedcom.io/terms/v7/RESN', min: 0, max: 1 },
			SDATE: { uri: 'https://gedcom.io/terms/v7/SDATE', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			TYPE: { uri: 'https://gedcom.io/terms/v7/TYPE', min: 0, max: 1 },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WIFE: { uri: 'https://gedcom.io/terms/v7/WIFE', min: 0, max: 1 },
			WWW: { uri: 'https://gedcom.io/terms/v7/WWW', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/FAM-RESI': {
		tag: 'RESI',
		payload: { kind: 'string' },
		subs: {
			ADDR: { uri: 'https://gedcom.io/terms/v7/ADDR', min: 0, max: 1 },
			AGNC: { uri: 'https://gedcom.io/terms/v7/AGNC', min: 0, max: 1 },
			ASSO: { uri: 'https://gedcom.io/terms/v7/ASSO', min: 0, max: null },
			CAUS: { uri: 'https://gedcom.io/terms/v7/CAUS', min: 0, max: 1 },
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			EMAIL: { uri: 'https://gedcom.io/terms/v7/EMAIL', min: 0, max: null },
			FAX: { uri: 'https://gedcom.io/terms/v7/FAX', min: 0, max: null },
			HUSB: { uri: 'https://gedcom.io/terms/v7/HUSB', min: 0, max: 1 },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			PHON: { uri: 'https://gedcom.io/terms/v7/PHON', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			RELI: { uri: 'https://gedcom.io/terms/v7/RELI', min: 0, max: 1 },
			RESN: { uri: 'https://gedcom.io/terms/v7/RESN', min: 0, max: 1 },
			SDATE: { uri: 'https://gedcom.io/terms/v7/SDATE', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			TYPE: { uri: 'https://gedcom.io/terms/v7/TYPE', min: 0, max: 1 },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WIFE: { uri: 'https://gedcom.io/terms/v7/WIFE', min: 0, max: 1 },
			WWW: { uri: 'https://gedcom.io/terms/v7/WWW', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/FAM-WIFE': {
		tag: 'WIFE',
		payload: { kind: 'pointer', target: 'https://gedcom.io/terms/v7/record-INDI' },
		subs: { PHRASE: { uri: 'https://gedcom.io/terms/v7/PHRASE', min: 0, max: 1 } }
	},
	'https://gedcom.io/terms/v7/FAMC': {
		tag: 'FAMC',
		payload: { kind: 'pointer', target: 'https://gedcom.io/terms/v7/record-FAM' },
		subs: {}
	},
	'https://gedcom.io/terms/v7/FAMC-ADOP': {
		tag: 'ADOP',
		payload: { kind: 'enum', enumSet: 'https://gedcom.io/terms/v7/enumset-ADOP' },
		subs: { PHRASE: { uri: 'https://gedcom.io/terms/v7/PHRASE', min: 0, max: 1 } }
	},
	'https://gedcom.io/terms/v7/FAMC-STAT': {
		tag: 'STAT',
		payload: { kind: 'enum', enumSet: 'https://gedcom.io/terms/v7/enumset-FAMC-STAT' },
		subs: { PHRASE: { uri: 'https://gedcom.io/terms/v7/PHRASE', min: 0, max: 1 } }
	},
	'https://gedcom.io/terms/v7/FAMS': {
		tag: 'FAMS',
		payload: { kind: 'pointer', target: 'https://gedcom.io/terms/v7/record-FAM' },
		subs: {
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/FAX': { tag: 'FAX', payload: { kind: 'string' }, subs: {} },
	'https://gedcom.io/terms/v7/FCOM': {
		tag: 'FCOM',
		payload: { kind: 'yOrNull' },
		subs: {
			ADDR: { uri: 'https://gedcom.io/terms/v7/ADDR', min: 0, max: 1 },
			AGE: { uri: 'https://gedcom.io/terms/v7/AGE', min: 0, max: 1 },
			AGNC: { uri: 'https://gedcom.io/terms/v7/AGNC', min: 0, max: 1 },
			ASSO: { uri: 'https://gedcom.io/terms/v7/ASSO', min: 0, max: null },
			CAUS: { uri: 'https://gedcom.io/terms/v7/CAUS', min: 0, max: 1 },
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			EMAIL: { uri: 'https://gedcom.io/terms/v7/EMAIL', min: 0, max: null },
			FAX: { uri: 'https://gedcom.io/terms/v7/FAX', min: 0, max: null },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			PHON: { uri: 'https://gedcom.io/terms/v7/PHON', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			RELI: { uri: 'https://gedcom.io/terms/v7/RELI', min: 0, max: 1 },
			RESN: { uri: 'https://gedcom.io/terms/v7/RESN', min: 0, max: 1 },
			SDATE: { uri: 'https://gedcom.io/terms/v7/SDATE', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			TYPE: { uri: 'https://gedcom.io/terms/v7/TYPE', min: 0, max: 1 },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WWW: { uri: 'https://gedcom.io/terms/v7/WWW', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/FILE': {
		tag: 'FILE',
		payload: { kind: 'filePath' },
		subs: {
			FORM: { uri: 'https://gedcom.io/terms/v7/FORM', min: 1, max: 1 },
			TITL: { uri: 'https://gedcom.io/terms/v7/TITL', min: 0, max: 1 },
			TRAN: { uri: 'https://gedcom.io/terms/v7/FILE-TRAN', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/FILE-TRAN': {
		tag: 'TRAN',
		payload: { kind: 'filePath' },
		subs: { FORM: { uri: 'https://gedcom.io/terms/v7/FORM', min: 1, max: 1 } }
	},
	'https://gedcom.io/terms/v7/FORM': {
		tag: 'FORM',
		payload: { kind: 'mediaType' },
		subs: { MEDI: { uri: 'https://gedcom.io/terms/v7/MEDI', min: 0, max: 1 } }
	},
	'https://gedcom.io/terms/v7/GEDC': {
		tag: 'GEDC',
		payload: { kind: 'none' },
		subs: { VERS: { uri: 'https://gedcom.io/terms/v7/GEDC-VERS', min: 1, max: 1 } }
	},
	'https://gedcom.io/terms/v7/GEDC-VERS': { tag: 'VERS', payload: { kind: 'string' }, subs: {} },
	'https://gedcom.io/terms/v7/GIVN': { tag: 'GIVN', payload: { kind: 'string' }, subs: {} },
	'https://gedcom.io/terms/v7/GRAD': {
		tag: 'GRAD',
		payload: { kind: 'yOrNull' },
		subs: {
			ADDR: { uri: 'https://gedcom.io/terms/v7/ADDR', min: 0, max: 1 },
			AGE: { uri: 'https://gedcom.io/terms/v7/AGE', min: 0, max: 1 },
			AGNC: { uri: 'https://gedcom.io/terms/v7/AGNC', min: 0, max: 1 },
			ASSO: { uri: 'https://gedcom.io/terms/v7/ASSO', min: 0, max: null },
			CAUS: { uri: 'https://gedcom.io/terms/v7/CAUS', min: 0, max: 1 },
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			EMAIL: { uri: 'https://gedcom.io/terms/v7/EMAIL', min: 0, max: null },
			FAX: { uri: 'https://gedcom.io/terms/v7/FAX', min: 0, max: null },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			PHON: { uri: 'https://gedcom.io/terms/v7/PHON', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			RELI: { uri: 'https://gedcom.io/terms/v7/RELI', min: 0, max: 1 },
			RESN: { uri: 'https://gedcom.io/terms/v7/RESN', min: 0, max: 1 },
			SDATE: { uri: 'https://gedcom.io/terms/v7/SDATE', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			TYPE: { uri: 'https://gedcom.io/terms/v7/TYPE', min: 0, max: 1 },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WWW: { uri: 'https://gedcom.io/terms/v7/WWW', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/HEAD': {
		tag: 'HEAD',
		payload: { kind: 'none' },
		subs: {
			COPR: { uri: 'https://gedcom.io/terms/v7/COPR', min: 0, max: 1 },
			DATE: { uri: 'https://gedcom.io/terms/v7/HEAD-DATE', min: 0, max: 1 },
			DEST: { uri: 'https://gedcom.io/terms/v7/DEST', min: 0, max: 1 },
			GEDC: { uri: 'https://gedcom.io/terms/v7/GEDC', min: 1, max: 1 },
			LANG: { uri: 'https://gedcom.io/terms/v7/HEAD-LANG', min: 0, max: 1 },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: 1 },
			PLAC: { uri: 'https://gedcom.io/terms/v7/HEAD-PLAC', min: 0, max: 1 },
			SCHMA: { uri: 'https://gedcom.io/terms/v7/SCHMA', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: 1 },
			SOUR: { uri: 'https://gedcom.io/terms/v7/HEAD-SOUR', min: 0, max: 1 },
			SUBM: { uri: 'https://gedcom.io/terms/v7/SUBM', min: 0, max: 1 }
		}
	},
	'https://gedcom.io/terms/v7/HEAD-DATE': {
		tag: 'DATE',
		payload: { kind: 'dateExact' },
		subs: { TIME: { uri: 'https://gedcom.io/terms/v7/TIME', min: 0, max: 1 } }
	},
	'https://gedcom.io/terms/v7/HEAD-LANG': { tag: 'LANG', payload: { kind: 'language' }, subs: {} },
	'https://gedcom.io/terms/v7/HEAD-PLAC': {
		tag: 'PLAC',
		payload: { kind: 'none' },
		subs: { FORM: { uri: 'https://gedcom.io/terms/v7/HEAD-PLAC-FORM', min: 1, max: 1 } }
	},
	'https://gedcom.io/terms/v7/HEAD-PLAC-FORM': {
		tag: 'FORM',
		payload: { kind: 'listText' },
		subs: {}
	},
	'https://gedcom.io/terms/v7/HEAD-SOUR': {
		tag: 'SOUR',
		payload: { kind: 'string' },
		subs: {
			CORP: { uri: 'https://gedcom.io/terms/v7/CORP', min: 0, max: 1 },
			DATA: { uri: 'https://gedcom.io/terms/v7/HEAD-SOUR-DATA', min: 0, max: 1 },
			NAME: { uri: 'https://gedcom.io/terms/v7/NAME', min: 0, max: 1 },
			VERS: { uri: 'https://gedcom.io/terms/v7/VERS', min: 0, max: 1 }
		}
	},
	'https://gedcom.io/terms/v7/HEAD-SOUR-DATA': {
		tag: 'DATA',
		payload: { kind: 'string' },
		subs: {
			COPR: { uri: 'https://gedcom.io/terms/v7/COPR', min: 0, max: 1 },
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE-exact', min: 0, max: 1 }
		}
	},
	'https://gedcom.io/terms/v7/HEIGHT': { tag: 'HEIGHT', payload: { kind: 'integer' }, subs: {} },
	'https://gedcom.io/terms/v7/HUSB': {
		tag: 'HUSB',
		payload: { kind: 'none' },
		subs: { AGE: { uri: 'https://gedcom.io/terms/v7/AGE', min: 1, max: 1 } }
	},
	'https://gedcom.io/terms/v7/IDNO': {
		tag: 'IDNO',
		payload: { kind: 'string' },
		subs: {
			ADDR: { uri: 'https://gedcom.io/terms/v7/ADDR', min: 0, max: 1 },
			AGE: { uri: 'https://gedcom.io/terms/v7/AGE', min: 0, max: 1 },
			AGNC: { uri: 'https://gedcom.io/terms/v7/AGNC', min: 0, max: 1 },
			ASSO: { uri: 'https://gedcom.io/terms/v7/ASSO', min: 0, max: null },
			CAUS: { uri: 'https://gedcom.io/terms/v7/CAUS', min: 0, max: 1 },
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			EMAIL: { uri: 'https://gedcom.io/terms/v7/EMAIL', min: 0, max: null },
			FAX: { uri: 'https://gedcom.io/terms/v7/FAX', min: 0, max: null },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			PHON: { uri: 'https://gedcom.io/terms/v7/PHON', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			RELI: { uri: 'https://gedcom.io/terms/v7/RELI', min: 0, max: 1 },
			RESN: { uri: 'https://gedcom.io/terms/v7/RESN', min: 0, max: 1 },
			SDATE: { uri: 'https://gedcom.io/terms/v7/SDATE', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			TYPE: { uri: 'https://gedcom.io/terms/v7/TYPE', min: 1, max: 1 },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WWW: { uri: 'https://gedcom.io/terms/v7/WWW', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/IMMI': {
		tag: 'IMMI',
		payload: { kind: 'yOrNull' },
		subs: {
			ADDR: { uri: 'https://gedcom.io/terms/v7/ADDR', min: 0, max: 1 },
			AGE: { uri: 'https://gedcom.io/terms/v7/AGE', min: 0, max: 1 },
			AGNC: { uri: 'https://gedcom.io/terms/v7/AGNC', min: 0, max: 1 },
			ASSO: { uri: 'https://gedcom.io/terms/v7/ASSO', min: 0, max: null },
			CAUS: { uri: 'https://gedcom.io/terms/v7/CAUS', min: 0, max: 1 },
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			EMAIL: { uri: 'https://gedcom.io/terms/v7/EMAIL', min: 0, max: null },
			FAX: { uri: 'https://gedcom.io/terms/v7/FAX', min: 0, max: null },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			PHON: { uri: 'https://gedcom.io/terms/v7/PHON', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			RELI: { uri: 'https://gedcom.io/terms/v7/RELI', min: 0, max: 1 },
			RESN: { uri: 'https://gedcom.io/terms/v7/RESN', min: 0, max: 1 },
			SDATE: { uri: 'https://gedcom.io/terms/v7/SDATE', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			TYPE: { uri: 'https://gedcom.io/terms/v7/TYPE', min: 0, max: 1 },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WWW: { uri: 'https://gedcom.io/terms/v7/WWW', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/INDI-CENS': {
		tag: 'CENS',
		payload: { kind: 'yOrNull' },
		subs: {
			ADDR: { uri: 'https://gedcom.io/terms/v7/ADDR', min: 0, max: 1 },
			AGE: { uri: 'https://gedcom.io/terms/v7/AGE', min: 0, max: 1 },
			AGNC: { uri: 'https://gedcom.io/terms/v7/AGNC', min: 0, max: 1 },
			ASSO: { uri: 'https://gedcom.io/terms/v7/ASSO', min: 0, max: null },
			CAUS: { uri: 'https://gedcom.io/terms/v7/CAUS', min: 0, max: 1 },
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			EMAIL: { uri: 'https://gedcom.io/terms/v7/EMAIL', min: 0, max: null },
			FAX: { uri: 'https://gedcom.io/terms/v7/FAX', min: 0, max: null },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			PHON: { uri: 'https://gedcom.io/terms/v7/PHON', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			RELI: { uri: 'https://gedcom.io/terms/v7/RELI', min: 0, max: 1 },
			RESN: { uri: 'https://gedcom.io/terms/v7/RESN', min: 0, max: 1 },
			SDATE: { uri: 'https://gedcom.io/terms/v7/SDATE', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			TYPE: { uri: 'https://gedcom.io/terms/v7/TYPE', min: 0, max: 1 },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WWW: { uri: 'https://gedcom.io/terms/v7/WWW', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/INDI-EVEN': {
		tag: 'EVEN',
		payload: { kind: 'string' },
		subs: {
			ADDR: { uri: 'https://gedcom.io/terms/v7/ADDR', min: 0, max: 1 },
			AGE: { uri: 'https://gedcom.io/terms/v7/AGE', min: 0, max: 1 },
			AGNC: { uri: 'https://gedcom.io/terms/v7/AGNC', min: 0, max: 1 },
			ASSO: { uri: 'https://gedcom.io/terms/v7/ASSO', min: 0, max: null },
			CAUS: { uri: 'https://gedcom.io/terms/v7/CAUS', min: 0, max: 1 },
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			EMAIL: { uri: 'https://gedcom.io/terms/v7/EMAIL', min: 0, max: null },
			FAX: { uri: 'https://gedcom.io/terms/v7/FAX', min: 0, max: null },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			PHON: { uri: 'https://gedcom.io/terms/v7/PHON', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			RELI: { uri: 'https://gedcom.io/terms/v7/RELI', min: 0, max: 1 },
			RESN: { uri: 'https://gedcom.io/terms/v7/RESN', min: 0, max: 1 },
			SDATE: { uri: 'https://gedcom.io/terms/v7/SDATE', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			TYPE: { uri: 'https://gedcom.io/terms/v7/TYPE', min: 1, max: 1 },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WWW: { uri: 'https://gedcom.io/terms/v7/WWW', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/INDI-FACT': {
		tag: 'FACT',
		payload: { kind: 'string' },
		subs: {
			ADDR: { uri: 'https://gedcom.io/terms/v7/ADDR', min: 0, max: 1 },
			AGE: { uri: 'https://gedcom.io/terms/v7/AGE', min: 0, max: 1 },
			AGNC: { uri: 'https://gedcom.io/terms/v7/AGNC', min: 0, max: 1 },
			ASSO: { uri: 'https://gedcom.io/terms/v7/ASSO', min: 0, max: null },
			CAUS: { uri: 'https://gedcom.io/terms/v7/CAUS', min: 0, max: 1 },
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			EMAIL: { uri: 'https://gedcom.io/terms/v7/EMAIL', min: 0, max: null },
			FAX: { uri: 'https://gedcom.io/terms/v7/FAX', min: 0, max: null },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			PHON: { uri: 'https://gedcom.io/terms/v7/PHON', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			RELI: { uri: 'https://gedcom.io/terms/v7/RELI', min: 0, max: 1 },
			RESN: { uri: 'https://gedcom.io/terms/v7/RESN', min: 0, max: 1 },
			SDATE: { uri: 'https://gedcom.io/terms/v7/SDATE', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			TYPE: { uri: 'https://gedcom.io/terms/v7/TYPE', min: 1, max: 1 },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WWW: { uri: 'https://gedcom.io/terms/v7/WWW', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/INDI-FAMC': {
		tag: 'FAMC',
		payload: { kind: 'pointer', target: 'https://gedcom.io/terms/v7/record-FAM' },
		subs: {
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			PEDI: { uri: 'https://gedcom.io/terms/v7/PEDI', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			STAT: { uri: 'https://gedcom.io/terms/v7/FAMC-STAT', min: 0, max: 1 }
		}
	},
	'https://gedcom.io/terms/v7/INDI-NAME': {
		tag: 'NAME',
		payload: { kind: 'name' },
		subs: {
			GIVN: { uri: 'https://gedcom.io/terms/v7/GIVN', min: 0, max: null },
			NICK: { uri: 'https://gedcom.io/terms/v7/NICK', min: 0, max: null },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			NPFX: { uri: 'https://gedcom.io/terms/v7/NPFX', min: 0, max: null },
			NSFX: { uri: 'https://gedcom.io/terms/v7/NSFX', min: 0, max: null },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			SPFX: { uri: 'https://gedcom.io/terms/v7/SPFX', min: 0, max: null },
			SURN: { uri: 'https://gedcom.io/terms/v7/SURN', min: 0, max: null },
			TRAN: { uri: 'https://gedcom.io/terms/v7/NAME-TRAN', min: 0, max: null },
			TYPE: { uri: 'https://gedcom.io/terms/v7/NAME-TYPE', min: 0, max: 1 }
		}
	},
	'https://gedcom.io/terms/v7/INDI-NCHI': {
		tag: 'NCHI',
		payload: { kind: 'integer' },
		subs: {
			ADDR: { uri: 'https://gedcom.io/terms/v7/ADDR', min: 0, max: 1 },
			AGE: { uri: 'https://gedcom.io/terms/v7/AGE', min: 0, max: 1 },
			AGNC: { uri: 'https://gedcom.io/terms/v7/AGNC', min: 0, max: 1 },
			ASSO: { uri: 'https://gedcom.io/terms/v7/ASSO', min: 0, max: null },
			CAUS: { uri: 'https://gedcom.io/terms/v7/CAUS', min: 0, max: 1 },
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			EMAIL: { uri: 'https://gedcom.io/terms/v7/EMAIL', min: 0, max: null },
			FAX: { uri: 'https://gedcom.io/terms/v7/FAX', min: 0, max: null },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			PHON: { uri: 'https://gedcom.io/terms/v7/PHON', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			RELI: { uri: 'https://gedcom.io/terms/v7/RELI', min: 0, max: 1 },
			RESN: { uri: 'https://gedcom.io/terms/v7/RESN', min: 0, max: 1 },
			SDATE: { uri: 'https://gedcom.io/terms/v7/SDATE', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			TYPE: { uri: 'https://gedcom.io/terms/v7/TYPE', min: 0, max: 1 },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WWW: { uri: 'https://gedcom.io/terms/v7/WWW', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/INDI-RELI': {
		tag: 'RELI',
		payload: { kind: 'string' },
		subs: {
			ADDR: { uri: 'https://gedcom.io/terms/v7/ADDR', min: 0, max: 1 },
			AGE: { uri: 'https://gedcom.io/terms/v7/AGE', min: 0, max: 1 },
			AGNC: { uri: 'https://gedcom.io/terms/v7/AGNC', min: 0, max: 1 },
			ASSO: { uri: 'https://gedcom.io/terms/v7/ASSO', min: 0, max: null },
			CAUS: { uri: 'https://gedcom.io/terms/v7/CAUS', min: 0, max: 1 },
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			EMAIL: { uri: 'https://gedcom.io/terms/v7/EMAIL', min: 0, max: null },
			FAX: { uri: 'https://gedcom.io/terms/v7/FAX', min: 0, max: null },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			PHON: { uri: 'https://gedcom.io/terms/v7/PHON', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			RELI: { uri: 'https://gedcom.io/terms/v7/RELI', min: 0, max: 1 },
			RESN: { uri: 'https://gedcom.io/terms/v7/RESN', min: 0, max: 1 },
			SDATE: { uri: 'https://gedcom.io/terms/v7/SDATE', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			TYPE: { uri: 'https://gedcom.io/terms/v7/TYPE', min: 0, max: 1 },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WWW: { uri: 'https://gedcom.io/terms/v7/WWW', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/INDI-RESI': {
		tag: 'RESI',
		payload: { kind: 'string' },
		subs: {
			ADDR: { uri: 'https://gedcom.io/terms/v7/ADDR', min: 0, max: 1 },
			AGE: { uri: 'https://gedcom.io/terms/v7/AGE', min: 0, max: 1 },
			AGNC: { uri: 'https://gedcom.io/terms/v7/AGNC', min: 0, max: 1 },
			ASSO: { uri: 'https://gedcom.io/terms/v7/ASSO', min: 0, max: null },
			CAUS: { uri: 'https://gedcom.io/terms/v7/CAUS', min: 0, max: 1 },
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			EMAIL: { uri: 'https://gedcom.io/terms/v7/EMAIL', min: 0, max: null },
			FAX: { uri: 'https://gedcom.io/terms/v7/FAX', min: 0, max: null },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			PHON: { uri: 'https://gedcom.io/terms/v7/PHON', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			RELI: { uri: 'https://gedcom.io/terms/v7/RELI', min: 0, max: 1 },
			RESN: { uri: 'https://gedcom.io/terms/v7/RESN', min: 0, max: 1 },
			SDATE: { uri: 'https://gedcom.io/terms/v7/SDATE', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			TYPE: { uri: 'https://gedcom.io/terms/v7/TYPE', min: 0, max: 1 },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WWW: { uri: 'https://gedcom.io/terms/v7/WWW', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/INDI-TITL': {
		tag: 'TITL',
		payload: { kind: 'string' },
		subs: {
			ADDR: { uri: 'https://gedcom.io/terms/v7/ADDR', min: 0, max: 1 },
			AGE: { uri: 'https://gedcom.io/terms/v7/AGE', min: 0, max: 1 },
			AGNC: { uri: 'https://gedcom.io/terms/v7/AGNC', min: 0, max: 1 },
			ASSO: { uri: 'https://gedcom.io/terms/v7/ASSO', min: 0, max: null },
			CAUS: { uri: 'https://gedcom.io/terms/v7/CAUS', min: 0, max: 1 },
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			EMAIL: { uri: 'https://gedcom.io/terms/v7/EMAIL', min: 0, max: null },
			FAX: { uri: 'https://gedcom.io/terms/v7/FAX', min: 0, max: null },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			PHON: { uri: 'https://gedcom.io/terms/v7/PHON', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			RELI: { uri: 'https://gedcom.io/terms/v7/RELI', min: 0, max: 1 },
			RESN: { uri: 'https://gedcom.io/terms/v7/RESN', min: 0, max: 1 },
			SDATE: { uri: 'https://gedcom.io/terms/v7/SDATE', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			TYPE: { uri: 'https://gedcom.io/terms/v7/TYPE', min: 0, max: 1 },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WWW: { uri: 'https://gedcom.io/terms/v7/WWW', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/INIL': {
		tag: 'INIL',
		payload: { kind: 'none' },
		subs: {
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			STAT: { uri: 'https://gedcom.io/terms/v7/ord-STAT', min: 0, max: 1 },
			TEMP: { uri: 'https://gedcom.io/terms/v7/TEMP', min: 0, max: 1 }
		}
	},
	'https://gedcom.io/terms/v7/LANG': { tag: 'LANG', payload: { kind: 'language' }, subs: {} },
	'https://gedcom.io/terms/v7/LATI': { tag: 'LATI', payload: { kind: 'latitude' }, subs: {} },
	'https://gedcom.io/terms/v7/LEFT': { tag: 'LEFT', payload: { kind: 'integer' }, subs: {} },
	'https://gedcom.io/terms/v7/LONG': { tag: 'LONG', payload: { kind: 'longitude' }, subs: {} },
	'https://gedcom.io/terms/v7/MAP': {
		tag: 'MAP',
		payload: { kind: 'none' },
		subs: {
			LATI: { uri: 'https://gedcom.io/terms/v7/LATI', min: 1, max: 1 },
			LONG: { uri: 'https://gedcom.io/terms/v7/LONG', min: 1, max: 1 }
		}
	},
	'https://gedcom.io/terms/v7/MARB': {
		tag: 'MARB',
		payload: { kind: 'yOrNull' },
		subs: {
			ADDR: { uri: 'https://gedcom.io/terms/v7/ADDR', min: 0, max: 1 },
			AGNC: { uri: 'https://gedcom.io/terms/v7/AGNC', min: 0, max: 1 },
			ASSO: { uri: 'https://gedcom.io/terms/v7/ASSO', min: 0, max: null },
			CAUS: { uri: 'https://gedcom.io/terms/v7/CAUS', min: 0, max: 1 },
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			EMAIL: { uri: 'https://gedcom.io/terms/v7/EMAIL', min: 0, max: null },
			FAX: { uri: 'https://gedcom.io/terms/v7/FAX', min: 0, max: null },
			HUSB: { uri: 'https://gedcom.io/terms/v7/HUSB', min: 0, max: 1 },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			PHON: { uri: 'https://gedcom.io/terms/v7/PHON', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			RELI: { uri: 'https://gedcom.io/terms/v7/RELI', min: 0, max: 1 },
			RESN: { uri: 'https://gedcom.io/terms/v7/RESN', min: 0, max: 1 },
			SDATE: { uri: 'https://gedcom.io/terms/v7/SDATE', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			TYPE: { uri: 'https://gedcom.io/terms/v7/TYPE', min: 0, max: 1 },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WIFE: { uri: 'https://gedcom.io/terms/v7/WIFE', min: 0, max: 1 },
			WWW: { uri: 'https://gedcom.io/terms/v7/WWW', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/MARC': {
		tag: 'MARC',
		payload: { kind: 'yOrNull' },
		subs: {
			ADDR: { uri: 'https://gedcom.io/terms/v7/ADDR', min: 0, max: 1 },
			AGNC: { uri: 'https://gedcom.io/terms/v7/AGNC', min: 0, max: 1 },
			ASSO: { uri: 'https://gedcom.io/terms/v7/ASSO', min: 0, max: null },
			CAUS: { uri: 'https://gedcom.io/terms/v7/CAUS', min: 0, max: 1 },
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			EMAIL: { uri: 'https://gedcom.io/terms/v7/EMAIL', min: 0, max: null },
			FAX: { uri: 'https://gedcom.io/terms/v7/FAX', min: 0, max: null },
			HUSB: { uri: 'https://gedcom.io/terms/v7/HUSB', min: 0, max: 1 },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			PHON: { uri: 'https://gedcom.io/terms/v7/PHON', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			RELI: { uri: 'https://gedcom.io/terms/v7/RELI', min: 0, max: 1 },
			RESN: { uri: 'https://gedcom.io/terms/v7/RESN', min: 0, max: 1 },
			SDATE: { uri: 'https://gedcom.io/terms/v7/SDATE', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			TYPE: { uri: 'https://gedcom.io/terms/v7/TYPE', min: 0, max: 1 },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WIFE: { uri: 'https://gedcom.io/terms/v7/WIFE', min: 0, max: 1 },
			WWW: { uri: 'https://gedcom.io/terms/v7/WWW', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/MARL': {
		tag: 'MARL',
		payload: { kind: 'yOrNull' },
		subs: {
			ADDR: { uri: 'https://gedcom.io/terms/v7/ADDR', min: 0, max: 1 },
			AGNC: { uri: 'https://gedcom.io/terms/v7/AGNC', min: 0, max: 1 },
			ASSO: { uri: 'https://gedcom.io/terms/v7/ASSO', min: 0, max: null },
			CAUS: { uri: 'https://gedcom.io/terms/v7/CAUS', min: 0, max: 1 },
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			EMAIL: { uri: 'https://gedcom.io/terms/v7/EMAIL', min: 0, max: null },
			FAX: { uri: 'https://gedcom.io/terms/v7/FAX', min: 0, max: null },
			HUSB: { uri: 'https://gedcom.io/terms/v7/HUSB', min: 0, max: 1 },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			PHON: { uri: 'https://gedcom.io/terms/v7/PHON', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			RELI: { uri: 'https://gedcom.io/terms/v7/RELI', min: 0, max: 1 },
			RESN: { uri: 'https://gedcom.io/terms/v7/RESN', min: 0, max: 1 },
			SDATE: { uri: 'https://gedcom.io/terms/v7/SDATE', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			TYPE: { uri: 'https://gedcom.io/terms/v7/TYPE', min: 0, max: 1 },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WIFE: { uri: 'https://gedcom.io/terms/v7/WIFE', min: 0, max: 1 },
			WWW: { uri: 'https://gedcom.io/terms/v7/WWW', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/MARR': {
		tag: 'MARR',
		payload: { kind: 'yOrNull' },
		subs: {
			ADDR: { uri: 'https://gedcom.io/terms/v7/ADDR', min: 0, max: 1 },
			AGNC: { uri: 'https://gedcom.io/terms/v7/AGNC', min: 0, max: 1 },
			ASSO: { uri: 'https://gedcom.io/terms/v7/ASSO', min: 0, max: null },
			CAUS: { uri: 'https://gedcom.io/terms/v7/CAUS', min: 0, max: 1 },
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			EMAIL: { uri: 'https://gedcom.io/terms/v7/EMAIL', min: 0, max: null },
			FAX: { uri: 'https://gedcom.io/terms/v7/FAX', min: 0, max: null },
			HUSB: { uri: 'https://gedcom.io/terms/v7/HUSB', min: 0, max: 1 },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			PHON: { uri: 'https://gedcom.io/terms/v7/PHON', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			RELI: { uri: 'https://gedcom.io/terms/v7/RELI', min: 0, max: 1 },
			RESN: { uri: 'https://gedcom.io/terms/v7/RESN', min: 0, max: 1 },
			SDATE: { uri: 'https://gedcom.io/terms/v7/SDATE', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			TYPE: { uri: 'https://gedcom.io/terms/v7/TYPE', min: 0, max: 1 },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WIFE: { uri: 'https://gedcom.io/terms/v7/WIFE', min: 0, max: 1 },
			WWW: { uri: 'https://gedcom.io/terms/v7/WWW', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/MARS': {
		tag: 'MARS',
		payload: { kind: 'yOrNull' },
		subs: {
			ADDR: { uri: 'https://gedcom.io/terms/v7/ADDR', min: 0, max: 1 },
			AGNC: { uri: 'https://gedcom.io/terms/v7/AGNC', min: 0, max: 1 },
			ASSO: { uri: 'https://gedcom.io/terms/v7/ASSO', min: 0, max: null },
			CAUS: { uri: 'https://gedcom.io/terms/v7/CAUS', min: 0, max: 1 },
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			EMAIL: { uri: 'https://gedcom.io/terms/v7/EMAIL', min: 0, max: null },
			FAX: { uri: 'https://gedcom.io/terms/v7/FAX', min: 0, max: null },
			HUSB: { uri: 'https://gedcom.io/terms/v7/HUSB', min: 0, max: 1 },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			PHON: { uri: 'https://gedcom.io/terms/v7/PHON', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			RELI: { uri: 'https://gedcom.io/terms/v7/RELI', min: 0, max: 1 },
			RESN: { uri: 'https://gedcom.io/terms/v7/RESN', min: 0, max: 1 },
			SDATE: { uri: 'https://gedcom.io/terms/v7/SDATE', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			TYPE: { uri: 'https://gedcom.io/terms/v7/TYPE', min: 0, max: 1 },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WIFE: { uri: 'https://gedcom.io/terms/v7/WIFE', min: 0, max: 1 },
			WWW: { uri: 'https://gedcom.io/terms/v7/WWW', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/MEDI': {
		tag: 'MEDI',
		payload: { kind: 'enum', enumSet: 'https://gedcom.io/terms/v7/enumset-MEDI' },
		subs: { PHRASE: { uri: 'https://gedcom.io/terms/v7/PHRASE', min: 0, max: 1 } }
	},
	'https://gedcom.io/terms/v7/MIME': { tag: 'MIME', payload: { kind: 'mediaType' }, subs: {} },
	'https://gedcom.io/terms/v7/NAME': { tag: 'NAME', payload: { kind: 'string' }, subs: {} },
	'https://gedcom.io/terms/v7/NAME-TRAN': {
		tag: 'TRAN',
		payload: { kind: 'name' },
		subs: {
			GIVN: { uri: 'https://gedcom.io/terms/v7/GIVN', min: 0, max: null },
			LANG: { uri: 'https://gedcom.io/terms/v7/LANG', min: 1, max: 1 },
			NICK: { uri: 'https://gedcom.io/terms/v7/NICK', min: 0, max: null },
			NPFX: { uri: 'https://gedcom.io/terms/v7/NPFX', min: 0, max: null },
			NSFX: { uri: 'https://gedcom.io/terms/v7/NSFX', min: 0, max: null },
			SPFX: { uri: 'https://gedcom.io/terms/v7/SPFX', min: 0, max: null },
			SURN: { uri: 'https://gedcom.io/terms/v7/SURN', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/NAME-TYPE': {
		tag: 'TYPE',
		payload: { kind: 'enum', enumSet: 'https://gedcom.io/terms/v7/enumset-NAME-TYPE' },
		subs: { PHRASE: { uri: 'https://gedcom.io/terms/v7/PHRASE', min: 0, max: 1 } }
	},
	'https://gedcom.io/terms/v7/NATI': {
		tag: 'NATI',
		payload: { kind: 'string' },
		subs: {
			ADDR: { uri: 'https://gedcom.io/terms/v7/ADDR', min: 0, max: 1 },
			AGE: { uri: 'https://gedcom.io/terms/v7/AGE', min: 0, max: 1 },
			AGNC: { uri: 'https://gedcom.io/terms/v7/AGNC', min: 0, max: 1 },
			ASSO: { uri: 'https://gedcom.io/terms/v7/ASSO', min: 0, max: null },
			CAUS: { uri: 'https://gedcom.io/terms/v7/CAUS', min: 0, max: 1 },
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			EMAIL: { uri: 'https://gedcom.io/terms/v7/EMAIL', min: 0, max: null },
			FAX: { uri: 'https://gedcom.io/terms/v7/FAX', min: 0, max: null },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			PHON: { uri: 'https://gedcom.io/terms/v7/PHON', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			RELI: { uri: 'https://gedcom.io/terms/v7/RELI', min: 0, max: 1 },
			RESN: { uri: 'https://gedcom.io/terms/v7/RESN', min: 0, max: 1 },
			SDATE: { uri: 'https://gedcom.io/terms/v7/SDATE', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			TYPE: { uri: 'https://gedcom.io/terms/v7/TYPE', min: 0, max: 1 },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WWW: { uri: 'https://gedcom.io/terms/v7/WWW', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/NATU': {
		tag: 'NATU',
		payload: { kind: 'yOrNull' },
		subs: {
			ADDR: { uri: 'https://gedcom.io/terms/v7/ADDR', min: 0, max: 1 },
			AGE: { uri: 'https://gedcom.io/terms/v7/AGE', min: 0, max: 1 },
			AGNC: { uri: 'https://gedcom.io/terms/v7/AGNC', min: 0, max: 1 },
			ASSO: { uri: 'https://gedcom.io/terms/v7/ASSO', min: 0, max: null },
			CAUS: { uri: 'https://gedcom.io/terms/v7/CAUS', min: 0, max: 1 },
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			EMAIL: { uri: 'https://gedcom.io/terms/v7/EMAIL', min: 0, max: null },
			FAX: { uri: 'https://gedcom.io/terms/v7/FAX', min: 0, max: null },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			PHON: { uri: 'https://gedcom.io/terms/v7/PHON', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			RELI: { uri: 'https://gedcom.io/terms/v7/RELI', min: 0, max: 1 },
			RESN: { uri: 'https://gedcom.io/terms/v7/RESN', min: 0, max: 1 },
			SDATE: { uri: 'https://gedcom.io/terms/v7/SDATE', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			TYPE: { uri: 'https://gedcom.io/terms/v7/TYPE', min: 0, max: 1 },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WWW: { uri: 'https://gedcom.io/terms/v7/WWW', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/NICK': { tag: 'NICK', payload: { kind: 'string' }, subs: {} },
	'https://gedcom.io/terms/v7/NMR': {
		tag: 'NMR',
		payload: { kind: 'integer' },
		subs: {
			ADDR: { uri: 'https://gedcom.io/terms/v7/ADDR', min: 0, max: 1 },
			AGE: { uri: 'https://gedcom.io/terms/v7/AGE', min: 0, max: 1 },
			AGNC: { uri: 'https://gedcom.io/terms/v7/AGNC', min: 0, max: 1 },
			ASSO: { uri: 'https://gedcom.io/terms/v7/ASSO', min: 0, max: null },
			CAUS: { uri: 'https://gedcom.io/terms/v7/CAUS', min: 0, max: 1 },
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			EMAIL: { uri: 'https://gedcom.io/terms/v7/EMAIL', min: 0, max: null },
			FAX: { uri: 'https://gedcom.io/terms/v7/FAX', min: 0, max: null },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			PHON: { uri: 'https://gedcom.io/terms/v7/PHON', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			RELI: { uri: 'https://gedcom.io/terms/v7/RELI', min: 0, max: 1 },
			RESN: { uri: 'https://gedcom.io/terms/v7/RESN', min: 0, max: 1 },
			SDATE: { uri: 'https://gedcom.io/terms/v7/SDATE', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			TYPE: { uri: 'https://gedcom.io/terms/v7/TYPE', min: 0, max: 1 },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WWW: { uri: 'https://gedcom.io/terms/v7/WWW', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/NO': {
		tag: 'NO',
		payload: { kind: 'enum', enumSet: 'https://gedcom.io/terms/v7/enumset-EVEN' },
		subs: {
			DATE: { uri: 'https://gedcom.io/terms/v7/NO-DATE', min: 0, max: 1 },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/NO-DATE': {
		tag: 'DATE',
		payload: { kind: 'datePeriod' },
		subs: { PHRASE: { uri: 'https://gedcom.io/terms/v7/PHRASE', min: 0, max: 1 } }
	},
	'https://gedcom.io/terms/v7/NOTE': {
		tag: 'NOTE',
		payload: { kind: 'string' },
		subs: {
			LANG: { uri: 'https://gedcom.io/terms/v7/LANG', min: 0, max: 1 },
			MIME: { uri: 'https://gedcom.io/terms/v7/MIME', min: 0, max: 1 },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			TRAN: { uri: 'https://gedcom.io/terms/v7/NOTE-TRAN', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/NOTE-TRAN': {
		tag: 'TRAN',
		payload: { kind: 'string' },
		subs: {
			LANG: { uri: 'https://gedcom.io/terms/v7/LANG', min: 0, max: 1 },
			MIME: { uri: 'https://gedcom.io/terms/v7/MIME', min: 0, max: 1 }
		}
	},
	'https://gedcom.io/terms/v7/NPFX': { tag: 'NPFX', payload: { kind: 'string' }, subs: {} },
	'https://gedcom.io/terms/v7/NSFX': { tag: 'NSFX', payload: { kind: 'string' }, subs: {} },
	'https://gedcom.io/terms/v7/OBJE': {
		tag: 'OBJE',
		payload: { kind: 'pointer', target: 'https://gedcom.io/terms/v7/record-OBJE' },
		subs: {
			CROP: { uri: 'https://gedcom.io/terms/v7/CROP', min: 0, max: 1 },
			TITL: { uri: 'https://gedcom.io/terms/v7/TITL', min: 0, max: 1 }
		}
	},
	'https://gedcom.io/terms/v7/OCCU': {
		tag: 'OCCU',
		payload: { kind: 'string' },
		subs: {
			ADDR: { uri: 'https://gedcom.io/terms/v7/ADDR', min: 0, max: 1 },
			AGE: { uri: 'https://gedcom.io/terms/v7/AGE', min: 0, max: 1 },
			AGNC: { uri: 'https://gedcom.io/terms/v7/AGNC', min: 0, max: 1 },
			ASSO: { uri: 'https://gedcom.io/terms/v7/ASSO', min: 0, max: null },
			CAUS: { uri: 'https://gedcom.io/terms/v7/CAUS', min: 0, max: 1 },
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			EMAIL: { uri: 'https://gedcom.io/terms/v7/EMAIL', min: 0, max: null },
			FAX: { uri: 'https://gedcom.io/terms/v7/FAX', min: 0, max: null },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			PHON: { uri: 'https://gedcom.io/terms/v7/PHON', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			RELI: { uri: 'https://gedcom.io/terms/v7/RELI', min: 0, max: 1 },
			RESN: { uri: 'https://gedcom.io/terms/v7/RESN', min: 0, max: 1 },
			SDATE: { uri: 'https://gedcom.io/terms/v7/SDATE', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			TYPE: { uri: 'https://gedcom.io/terms/v7/TYPE', min: 0, max: 1 },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WWW: { uri: 'https://gedcom.io/terms/v7/WWW', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/ORDN': {
		tag: 'ORDN',
		payload: { kind: 'yOrNull' },
		subs: {
			ADDR: { uri: 'https://gedcom.io/terms/v7/ADDR', min: 0, max: 1 },
			AGE: { uri: 'https://gedcom.io/terms/v7/AGE', min: 0, max: 1 },
			AGNC: { uri: 'https://gedcom.io/terms/v7/AGNC', min: 0, max: 1 },
			ASSO: { uri: 'https://gedcom.io/terms/v7/ASSO', min: 0, max: null },
			CAUS: { uri: 'https://gedcom.io/terms/v7/CAUS', min: 0, max: 1 },
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			EMAIL: { uri: 'https://gedcom.io/terms/v7/EMAIL', min: 0, max: null },
			FAX: { uri: 'https://gedcom.io/terms/v7/FAX', min: 0, max: null },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			PHON: { uri: 'https://gedcom.io/terms/v7/PHON', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			RELI: { uri: 'https://gedcom.io/terms/v7/RELI', min: 0, max: 1 },
			RESN: { uri: 'https://gedcom.io/terms/v7/RESN', min: 0, max: 1 },
			SDATE: { uri: 'https://gedcom.io/terms/v7/SDATE', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			TYPE: { uri: 'https://gedcom.io/terms/v7/TYPE', min: 0, max: 1 },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WWW: { uri: 'https://gedcom.io/terms/v7/WWW', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/PAGE': { tag: 'PAGE', payload: { kind: 'string' }, subs: {} },
	'https://gedcom.io/terms/v7/PEDI': {
		tag: 'PEDI',
		payload: { kind: 'enum', enumSet: 'https://gedcom.io/terms/v7/enumset-PEDI' },
		subs: { PHRASE: { uri: 'https://gedcom.io/terms/v7/PHRASE', min: 0, max: 1 } }
	},
	'https://gedcom.io/terms/v7/PHON': { tag: 'PHON', payload: { kind: 'string' }, subs: {} },
	'https://gedcom.io/terms/v7/PHRASE': { tag: 'PHRASE', payload: { kind: 'string' }, subs: {} },
	'https://gedcom.io/terms/v7/PLAC': {
		tag: 'PLAC',
		payload: { kind: 'listText' },
		subs: {
			EXID: { uri: 'https://gedcom.io/terms/v7/EXID', min: 0, max: null },
			FORM: { uri: 'https://gedcom.io/terms/v7/PLAC-FORM', min: 0, max: 1 },
			LANG: { uri: 'https://gedcom.io/terms/v7/LANG', min: 0, max: 1 },
			MAP: { uri: 'https://gedcom.io/terms/v7/MAP', min: 0, max: 1 },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			TRAN: { uri: 'https://gedcom.io/terms/v7/PLAC-TRAN', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/PLAC-FORM': { tag: 'FORM', payload: { kind: 'listText' }, subs: {} },
	'https://gedcom.io/terms/v7/PLAC-TRAN': {
		tag: 'TRAN',
		payload: { kind: 'listText' },
		subs: { LANG: { uri: 'https://gedcom.io/terms/v7/LANG', min: 1, max: 1 } }
	},
	'https://gedcom.io/terms/v7/POST': { tag: 'POST', payload: { kind: 'string' }, subs: {} },
	'https://gedcom.io/terms/v7/PROB': {
		tag: 'PROB',
		payload: { kind: 'yOrNull' },
		subs: {
			ADDR: { uri: 'https://gedcom.io/terms/v7/ADDR', min: 0, max: 1 },
			AGE: { uri: 'https://gedcom.io/terms/v7/AGE', min: 0, max: 1 },
			AGNC: { uri: 'https://gedcom.io/terms/v7/AGNC', min: 0, max: 1 },
			ASSO: { uri: 'https://gedcom.io/terms/v7/ASSO', min: 0, max: null },
			CAUS: { uri: 'https://gedcom.io/terms/v7/CAUS', min: 0, max: 1 },
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			EMAIL: { uri: 'https://gedcom.io/terms/v7/EMAIL', min: 0, max: null },
			FAX: { uri: 'https://gedcom.io/terms/v7/FAX', min: 0, max: null },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			PHON: { uri: 'https://gedcom.io/terms/v7/PHON', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			RELI: { uri: 'https://gedcom.io/terms/v7/RELI', min: 0, max: 1 },
			RESN: { uri: 'https://gedcom.io/terms/v7/RESN', min: 0, max: 1 },
			SDATE: { uri: 'https://gedcom.io/terms/v7/SDATE', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			TYPE: { uri: 'https://gedcom.io/terms/v7/TYPE', min: 0, max: 1 },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WWW: { uri: 'https://gedcom.io/terms/v7/WWW', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/PROP': {
		tag: 'PROP',
		payload: { kind: 'string' },
		subs: {
			ADDR: { uri: 'https://gedcom.io/terms/v7/ADDR', min: 0, max: 1 },
			AGE: { uri: 'https://gedcom.io/terms/v7/AGE', min: 0, max: 1 },
			AGNC: { uri: 'https://gedcom.io/terms/v7/AGNC', min: 0, max: 1 },
			ASSO: { uri: 'https://gedcom.io/terms/v7/ASSO', min: 0, max: null },
			CAUS: { uri: 'https://gedcom.io/terms/v7/CAUS', min: 0, max: 1 },
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			EMAIL: { uri: 'https://gedcom.io/terms/v7/EMAIL', min: 0, max: null },
			FAX: { uri: 'https://gedcom.io/terms/v7/FAX', min: 0, max: null },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			PHON: { uri: 'https://gedcom.io/terms/v7/PHON', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			RELI: { uri: 'https://gedcom.io/terms/v7/RELI', min: 0, max: 1 },
			RESN: { uri: 'https://gedcom.io/terms/v7/RESN', min: 0, max: 1 },
			SDATE: { uri: 'https://gedcom.io/terms/v7/SDATE', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			TYPE: { uri: 'https://gedcom.io/terms/v7/TYPE', min: 0, max: 1 },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WWW: { uri: 'https://gedcom.io/terms/v7/WWW', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/PUBL': { tag: 'PUBL', payload: { kind: 'string' }, subs: {} },
	'https://gedcom.io/terms/v7/QUAY': {
		tag: 'QUAY',
		payload: { kind: 'enum', enumSet: 'https://gedcom.io/terms/v7/enumset-QUAY' },
		subs: {}
	},
	'https://gedcom.io/terms/v7/REFN': {
		tag: 'REFN',
		payload: { kind: 'string' },
		subs: { TYPE: { uri: 'https://gedcom.io/terms/v7/TYPE', min: 0, max: 1 } }
	},
	'https://gedcom.io/terms/v7/RELI': { tag: 'RELI', payload: { kind: 'string' }, subs: {} },
	'https://gedcom.io/terms/v7/REPO': {
		tag: 'REPO',
		payload: { kind: 'pointer', target: 'https://gedcom.io/terms/v7/record-REPO' },
		subs: {
			CALN: { uri: 'https://gedcom.io/terms/v7/CALN', min: 0, max: null },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/RESN': {
		tag: 'RESN',
		payload: { kind: 'listEnum', enumSet: 'https://gedcom.io/terms/v7/enumset-RESN' },
		subs: {}
	},
	'https://gedcom.io/terms/v7/RETI': {
		tag: 'RETI',
		payload: { kind: 'yOrNull' },
		subs: {
			ADDR: { uri: 'https://gedcom.io/terms/v7/ADDR', min: 0, max: 1 },
			AGE: { uri: 'https://gedcom.io/terms/v7/AGE', min: 0, max: 1 },
			AGNC: { uri: 'https://gedcom.io/terms/v7/AGNC', min: 0, max: 1 },
			ASSO: { uri: 'https://gedcom.io/terms/v7/ASSO', min: 0, max: null },
			CAUS: { uri: 'https://gedcom.io/terms/v7/CAUS', min: 0, max: 1 },
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			EMAIL: { uri: 'https://gedcom.io/terms/v7/EMAIL', min: 0, max: null },
			FAX: { uri: 'https://gedcom.io/terms/v7/FAX', min: 0, max: null },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			PHON: { uri: 'https://gedcom.io/terms/v7/PHON', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			RELI: { uri: 'https://gedcom.io/terms/v7/RELI', min: 0, max: 1 },
			RESN: { uri: 'https://gedcom.io/terms/v7/RESN', min: 0, max: 1 },
			SDATE: { uri: 'https://gedcom.io/terms/v7/SDATE', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			TYPE: { uri: 'https://gedcom.io/terms/v7/TYPE', min: 0, max: 1 },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WWW: { uri: 'https://gedcom.io/terms/v7/WWW', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/ROLE': {
		tag: 'ROLE',
		payload: { kind: 'enum', enumSet: 'https://gedcom.io/terms/v7/enumset-ROLE' },
		subs: { PHRASE: { uri: 'https://gedcom.io/terms/v7/PHRASE', min: 0, max: 1 } }
	},
	'https://gedcom.io/terms/v7/SCHMA': {
		tag: 'SCHMA',
		payload: { kind: 'none' },
		subs: { TAG: { uri: 'https://gedcom.io/terms/v7/TAG', min: 0, max: null } }
	},
	'https://gedcom.io/terms/v7/SDATE': {
		tag: 'SDATE',
		payload: { kind: 'dateValue' },
		subs: {
			PHRASE: { uri: 'https://gedcom.io/terms/v7/PHRASE', min: 0, max: 1 },
			TIME: { uri: 'https://gedcom.io/terms/v7/TIME', min: 0, max: 1 }
		}
	},
	'https://gedcom.io/terms/v7/SEX': {
		tag: 'SEX',
		payload: { kind: 'enum', enumSet: 'https://gedcom.io/terms/v7/enumset-SEX' },
		subs: {}
	},
	'https://gedcom.io/terms/v7/SLGC': {
		tag: 'SLGC',
		payload: { kind: 'none' },
		subs: {
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			FAMC: { uri: 'https://gedcom.io/terms/v7/FAMC', min: 1, max: 1 },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			STAT: { uri: 'https://gedcom.io/terms/v7/ord-STAT', min: 0, max: 1 },
			TEMP: { uri: 'https://gedcom.io/terms/v7/TEMP', min: 0, max: 1 }
		}
	},
	'https://gedcom.io/terms/v7/SLGS': {
		tag: 'SLGS',
		payload: { kind: 'none' },
		subs: {
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			STAT: { uri: 'https://gedcom.io/terms/v7/ord-STAT', min: 0, max: 1 },
			TEMP: { uri: 'https://gedcom.io/terms/v7/TEMP', min: 0, max: 1 }
		}
	},
	'https://gedcom.io/terms/v7/SNOTE': {
		tag: 'SNOTE',
		payload: { kind: 'pointer', target: 'https://gedcom.io/terms/v7/record-SNOTE' },
		subs: {}
	},
	'https://gedcom.io/terms/v7/SOUR': {
		tag: 'SOUR',
		payload: { kind: 'pointer', target: 'https://gedcom.io/terms/v7/record-SOUR' },
		subs: {
			DATA: { uri: 'https://gedcom.io/terms/v7/SOUR-DATA', min: 0, max: 1 },
			EVEN: { uri: 'https://gedcom.io/terms/v7/SOUR-EVEN', min: 0, max: 1 },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			PAGE: { uri: 'https://gedcom.io/terms/v7/PAGE', min: 0, max: 1 },
			QUAY: { uri: 'https://gedcom.io/terms/v7/QUAY', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/SOUR-DATA': {
		tag: 'DATA',
		payload: { kind: 'none' },
		subs: {
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			TEXT: { uri: 'https://gedcom.io/terms/v7/TEXT', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/SOUR-EVEN': {
		tag: 'EVEN',
		payload: { kind: 'enum', enumSet: 'https://gedcom.io/terms/v7/enumset-EVENATTR' },
		subs: {
			PHRASE: { uri: 'https://gedcom.io/terms/v7/PHRASE', min: 0, max: 1 },
			ROLE: { uri: 'https://gedcom.io/terms/v7/ROLE', min: 0, max: 1 }
		}
	},
	'https://gedcom.io/terms/v7/SPFX': { tag: 'SPFX', payload: { kind: 'string' }, subs: {} },
	'https://gedcom.io/terms/v7/SSN': {
		tag: 'SSN',
		payload: { kind: 'string' },
		subs: {
			ADDR: { uri: 'https://gedcom.io/terms/v7/ADDR', min: 0, max: 1 },
			AGE: { uri: 'https://gedcom.io/terms/v7/AGE', min: 0, max: 1 },
			AGNC: { uri: 'https://gedcom.io/terms/v7/AGNC', min: 0, max: 1 },
			ASSO: { uri: 'https://gedcom.io/terms/v7/ASSO', min: 0, max: null },
			CAUS: { uri: 'https://gedcom.io/terms/v7/CAUS', min: 0, max: 1 },
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			EMAIL: { uri: 'https://gedcom.io/terms/v7/EMAIL', min: 0, max: null },
			FAX: { uri: 'https://gedcom.io/terms/v7/FAX', min: 0, max: null },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			PHON: { uri: 'https://gedcom.io/terms/v7/PHON', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			RELI: { uri: 'https://gedcom.io/terms/v7/RELI', min: 0, max: 1 },
			RESN: { uri: 'https://gedcom.io/terms/v7/RESN', min: 0, max: 1 },
			SDATE: { uri: 'https://gedcom.io/terms/v7/SDATE', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			TYPE: { uri: 'https://gedcom.io/terms/v7/TYPE', min: 0, max: 1 },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WWW: { uri: 'https://gedcom.io/terms/v7/WWW', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/STAE': { tag: 'STAE', payload: { kind: 'string' }, subs: {} },
	'https://gedcom.io/terms/v7/SUBM': {
		tag: 'SUBM',
		payload: { kind: 'pointer', target: 'https://gedcom.io/terms/v7/record-SUBM' },
		subs: {}
	},
	'https://gedcom.io/terms/v7/SUBM-LANG': { tag: 'LANG', payload: { kind: 'language' }, subs: {} },
	'https://gedcom.io/terms/v7/SURN': { tag: 'SURN', payload: { kind: 'string' }, subs: {} },
	'https://gedcom.io/terms/v7/TAG': { tag: 'TAG', payload: { kind: 'tagDef' }, subs: {} },
	'https://gedcom.io/terms/v7/TEMP': { tag: 'TEMP', payload: { kind: 'string' }, subs: {} },
	'https://gedcom.io/terms/v7/TEXT': {
		tag: 'TEXT',
		payload: { kind: 'string' },
		subs: {
			LANG: { uri: 'https://gedcom.io/terms/v7/LANG', min: 0, max: 1 },
			MIME: { uri: 'https://gedcom.io/terms/v7/MIME', min: 0, max: 1 }
		}
	},
	'https://gedcom.io/terms/v7/TIME': { tag: 'TIME', payload: { kind: 'time' }, subs: {} },
	'https://gedcom.io/terms/v7/TITL': { tag: 'TITL', payload: { kind: 'string' }, subs: {} },
	'https://gedcom.io/terms/v7/TOP': { tag: 'TOP', payload: { kind: 'integer' }, subs: {} },
	'https://gedcom.io/terms/v7/TRLR': { tag: 'TRLR', payload: { kind: 'none' }, subs: {} },
	'https://gedcom.io/terms/v7/TYPE': { tag: 'TYPE', payload: { kind: 'string' }, subs: {} },
	'https://gedcom.io/terms/v7/UID': { tag: 'UID', payload: { kind: 'string' }, subs: {} },
	'https://gedcom.io/terms/v7/VERS': { tag: 'VERS', payload: { kind: 'string' }, subs: {} },
	'https://gedcom.io/terms/v7/WIDTH': { tag: 'WIDTH', payload: { kind: 'integer' }, subs: {} },
	'https://gedcom.io/terms/v7/WIFE': {
		tag: 'WIFE',
		payload: { kind: 'none' },
		subs: { AGE: { uri: 'https://gedcom.io/terms/v7/AGE', min: 1, max: 1 } }
	},
	'https://gedcom.io/terms/v7/WILL': {
		tag: 'WILL',
		payload: { kind: 'yOrNull' },
		subs: {
			ADDR: { uri: 'https://gedcom.io/terms/v7/ADDR', min: 0, max: 1 },
			AGE: { uri: 'https://gedcom.io/terms/v7/AGE', min: 0, max: 1 },
			AGNC: { uri: 'https://gedcom.io/terms/v7/AGNC', min: 0, max: 1 },
			ASSO: { uri: 'https://gedcom.io/terms/v7/ASSO', min: 0, max: null },
			CAUS: { uri: 'https://gedcom.io/terms/v7/CAUS', min: 0, max: 1 },
			DATE: { uri: 'https://gedcom.io/terms/v7/DATE', min: 0, max: 1 },
			EMAIL: { uri: 'https://gedcom.io/terms/v7/EMAIL', min: 0, max: null },
			FAX: { uri: 'https://gedcom.io/terms/v7/FAX', min: 0, max: null },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			PHON: { uri: 'https://gedcom.io/terms/v7/PHON', min: 0, max: null },
			PLAC: { uri: 'https://gedcom.io/terms/v7/PLAC', min: 0, max: 1 },
			RELI: { uri: 'https://gedcom.io/terms/v7/RELI', min: 0, max: 1 },
			RESN: { uri: 'https://gedcom.io/terms/v7/RESN', min: 0, max: 1 },
			SDATE: { uri: 'https://gedcom.io/terms/v7/SDATE', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			TYPE: { uri: 'https://gedcom.io/terms/v7/TYPE', min: 0, max: 1 },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WWW: { uri: 'https://gedcom.io/terms/v7/WWW', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/WWW': { tag: 'WWW', payload: { kind: 'string' }, subs: {} },
	'https://gedcom.io/terms/v7/ord-STAT': {
		tag: 'STAT',
		payload: { kind: 'enum', enumSet: 'https://gedcom.io/terms/v7/enumset-ord-STAT' },
		subs: { DATE: { uri: 'https://gedcom.io/terms/v7/DATE-exact', min: 1, max: 1 } }
	},
	'https://gedcom.io/terms/v7/record-FAM': {
		tag: 'FAM',
		payload: { kind: 'none' },
		subs: {
			ANUL: { uri: 'https://gedcom.io/terms/v7/ANUL', min: 0, max: null },
			ASSO: { uri: 'https://gedcom.io/terms/v7/ASSO', min: 0, max: null },
			CENS: { uri: 'https://gedcom.io/terms/v7/FAM-CENS', min: 0, max: null },
			CHAN: { uri: 'https://gedcom.io/terms/v7/CHAN', min: 0, max: 1 },
			CHIL: { uri: 'https://gedcom.io/terms/v7/CHIL', min: 0, max: null },
			CREA: { uri: 'https://gedcom.io/terms/v7/CREA', min: 0, max: 1 },
			DIV: { uri: 'https://gedcom.io/terms/v7/DIV', min: 0, max: null },
			DIVF: { uri: 'https://gedcom.io/terms/v7/DIVF', min: 0, max: null },
			ENGA: { uri: 'https://gedcom.io/terms/v7/ENGA', min: 0, max: null },
			EVEN: { uri: 'https://gedcom.io/terms/v7/FAM-EVEN', min: 0, max: null },
			EXID: { uri: 'https://gedcom.io/terms/v7/EXID', min: 0, max: null },
			FACT: { uri: 'https://gedcom.io/terms/v7/FAM-FACT', min: 0, max: null },
			HUSB: { uri: 'https://gedcom.io/terms/v7/FAM-HUSB', min: 0, max: 1 },
			MARB: { uri: 'https://gedcom.io/terms/v7/MARB', min: 0, max: null },
			MARC: { uri: 'https://gedcom.io/terms/v7/MARC', min: 0, max: null },
			MARL: { uri: 'https://gedcom.io/terms/v7/MARL', min: 0, max: null },
			MARR: { uri: 'https://gedcom.io/terms/v7/MARR', min: 0, max: null },
			MARS: { uri: 'https://gedcom.io/terms/v7/MARS', min: 0, max: null },
			NCHI: { uri: 'https://gedcom.io/terms/v7/FAM-NCHI', min: 0, max: null },
			NO: { uri: 'https://gedcom.io/terms/v7/NO', min: 0, max: null },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			REFN: { uri: 'https://gedcom.io/terms/v7/REFN', min: 0, max: null },
			RESI: { uri: 'https://gedcom.io/terms/v7/FAM-RESI', min: 0, max: null },
			RESN: { uri: 'https://gedcom.io/terms/v7/RESN', min: 0, max: 1 },
			SLGS: { uri: 'https://gedcom.io/terms/v7/SLGS', min: 0, max: null },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			SUBM: { uri: 'https://gedcom.io/terms/v7/SUBM', min: 0, max: null },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WIFE: { uri: 'https://gedcom.io/terms/v7/FAM-WIFE', min: 0, max: 1 }
		}
	},
	'https://gedcom.io/terms/v7/record-INDI': {
		tag: 'INDI',
		payload: { kind: 'none' },
		subs: {
			ADOP: { uri: 'https://gedcom.io/terms/v7/ADOP', min: 0, max: null },
			ALIA: { uri: 'https://gedcom.io/terms/v7/ALIA', min: 0, max: null },
			ANCI: { uri: 'https://gedcom.io/terms/v7/ANCI', min: 0, max: null },
			ASSO: { uri: 'https://gedcom.io/terms/v7/ASSO', min: 0, max: null },
			BAPL: { uri: 'https://gedcom.io/terms/v7/BAPL', min: 0, max: null },
			BAPM: { uri: 'https://gedcom.io/terms/v7/BAPM', min: 0, max: null },
			BARM: { uri: 'https://gedcom.io/terms/v7/BARM', min: 0, max: null },
			BASM: { uri: 'https://gedcom.io/terms/v7/BASM', min: 0, max: null },
			BIRT: { uri: 'https://gedcom.io/terms/v7/BIRT', min: 0, max: null },
			BLES: { uri: 'https://gedcom.io/terms/v7/BLES', min: 0, max: null },
			BURI: { uri: 'https://gedcom.io/terms/v7/BURI', min: 0, max: null },
			CAST: { uri: 'https://gedcom.io/terms/v7/CAST', min: 0, max: null },
			CENS: { uri: 'https://gedcom.io/terms/v7/INDI-CENS', min: 0, max: null },
			CHAN: { uri: 'https://gedcom.io/terms/v7/CHAN', min: 0, max: 1 },
			CHR: { uri: 'https://gedcom.io/terms/v7/CHR', min: 0, max: null },
			CHRA: { uri: 'https://gedcom.io/terms/v7/CHRA', min: 0, max: null },
			CONF: { uri: 'https://gedcom.io/terms/v7/CONF', min: 0, max: null },
			CONL: { uri: 'https://gedcom.io/terms/v7/CONL', min: 0, max: null },
			CREA: { uri: 'https://gedcom.io/terms/v7/CREA', min: 0, max: 1 },
			CREM: { uri: 'https://gedcom.io/terms/v7/CREM', min: 0, max: null },
			DEAT: { uri: 'https://gedcom.io/terms/v7/DEAT', min: 0, max: null },
			DESI: { uri: 'https://gedcom.io/terms/v7/DESI', min: 0, max: null },
			DSCR: { uri: 'https://gedcom.io/terms/v7/DSCR', min: 0, max: null },
			EDUC: { uri: 'https://gedcom.io/terms/v7/EDUC', min: 0, max: null },
			EMIG: { uri: 'https://gedcom.io/terms/v7/EMIG', min: 0, max: null },
			ENDL: { uri: 'https://gedcom.io/terms/v7/ENDL', min: 0, max: null },
			EVEN: { uri: 'https://gedcom.io/terms/v7/INDI-EVEN', min: 0, max: null },
			EXID: { uri: 'https://gedcom.io/terms/v7/EXID', min: 0, max: null },
			FACT: { uri: 'https://gedcom.io/terms/v7/INDI-FACT', min: 0, max: null },
			FAMC: { uri: 'https://gedcom.io/terms/v7/INDI-FAMC', min: 0, max: null },
			FAMS: { uri: 'https://gedcom.io/terms/v7/FAMS', min: 0, max: null },
			FCOM: { uri: 'https://gedcom.io/terms/v7/FCOM', min: 0, max: null },
			GRAD: { uri: 'https://gedcom.io/terms/v7/GRAD', min: 0, max: null },
			IDNO: { uri: 'https://gedcom.io/terms/v7/IDNO', min: 0, max: null },
			IMMI: { uri: 'https://gedcom.io/terms/v7/IMMI', min: 0, max: null },
			INIL: { uri: 'https://gedcom.io/terms/v7/INIL', min: 0, max: null },
			NAME: { uri: 'https://gedcom.io/terms/v7/INDI-NAME', min: 0, max: null },
			NATI: { uri: 'https://gedcom.io/terms/v7/NATI', min: 0, max: null },
			NATU: { uri: 'https://gedcom.io/terms/v7/NATU', min: 0, max: null },
			NCHI: { uri: 'https://gedcom.io/terms/v7/INDI-NCHI', min: 0, max: null },
			NMR: { uri: 'https://gedcom.io/terms/v7/NMR', min: 0, max: null },
			NO: { uri: 'https://gedcom.io/terms/v7/NO', min: 0, max: null },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			OCCU: { uri: 'https://gedcom.io/terms/v7/OCCU', min: 0, max: null },
			ORDN: { uri: 'https://gedcom.io/terms/v7/ORDN', min: 0, max: null },
			PROB: { uri: 'https://gedcom.io/terms/v7/PROB', min: 0, max: null },
			PROP: { uri: 'https://gedcom.io/terms/v7/PROP', min: 0, max: null },
			REFN: { uri: 'https://gedcom.io/terms/v7/REFN', min: 0, max: null },
			RELI: { uri: 'https://gedcom.io/terms/v7/INDI-RELI', min: 0, max: null },
			RESI: { uri: 'https://gedcom.io/terms/v7/INDI-RESI', min: 0, max: null },
			RESN: { uri: 'https://gedcom.io/terms/v7/RESN', min: 0, max: 1 },
			RETI: { uri: 'https://gedcom.io/terms/v7/RETI', min: 0, max: null },
			SEX: { uri: 'https://gedcom.io/terms/v7/SEX', min: 0, max: 1 },
			SLGC: { uri: 'https://gedcom.io/terms/v7/SLGC', min: 0, max: null },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			SSN: { uri: 'https://gedcom.io/terms/v7/SSN', min: 0, max: null },
			SUBM: { uri: 'https://gedcom.io/terms/v7/SUBM', min: 0, max: null },
			TITL: { uri: 'https://gedcom.io/terms/v7/INDI-TITL', min: 0, max: null },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WILL: { uri: 'https://gedcom.io/terms/v7/WILL', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/record-OBJE': {
		tag: 'OBJE',
		payload: { kind: 'none' },
		subs: {
			CHAN: { uri: 'https://gedcom.io/terms/v7/CHAN', min: 0, max: 1 },
			CREA: { uri: 'https://gedcom.io/terms/v7/CREA', min: 0, max: 1 },
			EXID: { uri: 'https://gedcom.io/terms/v7/EXID', min: 0, max: null },
			FILE: { uri: 'https://gedcom.io/terms/v7/FILE', min: 1, max: null },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			REFN: { uri: 'https://gedcom.io/terms/v7/REFN', min: 0, max: null },
			RESN: { uri: 'https://gedcom.io/terms/v7/RESN', min: 0, max: 1 },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/record-REPO': {
		tag: 'REPO',
		payload: { kind: 'none' },
		subs: {
			ADDR: { uri: 'https://gedcom.io/terms/v7/ADDR', min: 0, max: 1 },
			CHAN: { uri: 'https://gedcom.io/terms/v7/CHAN', min: 0, max: 1 },
			CREA: { uri: 'https://gedcom.io/terms/v7/CREA', min: 0, max: 1 },
			EMAIL: { uri: 'https://gedcom.io/terms/v7/EMAIL', min: 0, max: null },
			EXID: { uri: 'https://gedcom.io/terms/v7/EXID', min: 0, max: null },
			FAX: { uri: 'https://gedcom.io/terms/v7/FAX', min: 0, max: null },
			NAME: { uri: 'https://gedcom.io/terms/v7/NAME', min: 1, max: 1 },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			PHON: { uri: 'https://gedcom.io/terms/v7/PHON', min: 0, max: null },
			REFN: { uri: 'https://gedcom.io/terms/v7/REFN', min: 0, max: null },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WWW: { uri: 'https://gedcom.io/terms/v7/WWW', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/record-SNOTE': {
		tag: 'SNOTE',
		payload: { kind: 'string' },
		subs: {
			CHAN: { uri: 'https://gedcom.io/terms/v7/CHAN', min: 0, max: 1 },
			CREA: { uri: 'https://gedcom.io/terms/v7/CREA', min: 0, max: 1 },
			EXID: { uri: 'https://gedcom.io/terms/v7/EXID', min: 0, max: null },
			LANG: { uri: 'https://gedcom.io/terms/v7/LANG', min: 0, max: 1 },
			MIME: { uri: 'https://gedcom.io/terms/v7/MIME', min: 0, max: 1 },
			REFN: { uri: 'https://gedcom.io/terms/v7/REFN', min: 0, max: null },
			SOUR: { uri: 'https://gedcom.io/terms/v7/SOUR', min: 0, max: null },
			TRAN: { uri: 'https://gedcom.io/terms/v7/NOTE-TRAN', min: 0, max: null },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/record-SOUR': {
		tag: 'SOUR',
		payload: { kind: 'none' },
		subs: {
			ABBR: { uri: 'https://gedcom.io/terms/v7/ABBR', min: 0, max: 1 },
			AUTH: { uri: 'https://gedcom.io/terms/v7/AUTH', min: 0, max: 1 },
			CHAN: { uri: 'https://gedcom.io/terms/v7/CHAN', min: 0, max: 1 },
			CREA: { uri: 'https://gedcom.io/terms/v7/CREA', min: 0, max: 1 },
			DATA: { uri: 'https://gedcom.io/terms/v7/DATA', min: 0, max: 1 },
			EXID: { uri: 'https://gedcom.io/terms/v7/EXID', min: 0, max: null },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			PUBL: { uri: 'https://gedcom.io/terms/v7/PUBL', min: 0, max: 1 },
			REFN: { uri: 'https://gedcom.io/terms/v7/REFN', min: 0, max: null },
			REPO: { uri: 'https://gedcom.io/terms/v7/REPO', min: 0, max: null },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			TEXT: { uri: 'https://gedcom.io/terms/v7/TEXT', min: 0, max: 1 },
			TITL: { uri: 'https://gedcom.io/terms/v7/TITL', min: 0, max: 1 },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null }
		}
	},
	'https://gedcom.io/terms/v7/record-SUBM': {
		tag: 'SUBM',
		payload: { kind: 'none' },
		subs: {
			ADDR: { uri: 'https://gedcom.io/terms/v7/ADDR', min: 0, max: 1 },
			CHAN: { uri: 'https://gedcom.io/terms/v7/CHAN', min: 0, max: 1 },
			CREA: { uri: 'https://gedcom.io/terms/v7/CREA', min: 0, max: 1 },
			EMAIL: { uri: 'https://gedcom.io/terms/v7/EMAIL', min: 0, max: null },
			EXID: { uri: 'https://gedcom.io/terms/v7/EXID', min: 0, max: null },
			FAX: { uri: 'https://gedcom.io/terms/v7/FAX', min: 0, max: null },
			LANG: { uri: 'https://gedcom.io/terms/v7/SUBM-LANG', min: 0, max: null },
			NAME: { uri: 'https://gedcom.io/terms/v7/NAME', min: 1, max: 1 },
			NOTE: { uri: 'https://gedcom.io/terms/v7/NOTE', min: 0, max: null },
			OBJE: { uri: 'https://gedcom.io/terms/v7/OBJE', min: 0, max: null },
			PHON: { uri: 'https://gedcom.io/terms/v7/PHON', min: 0, max: null },
			REFN: { uri: 'https://gedcom.io/terms/v7/REFN', min: 0, max: null },
			SNOTE: { uri: 'https://gedcom.io/terms/v7/SNOTE', min: 0, max: null },
			UID: { uri: 'https://gedcom.io/terms/v7/UID', min: 0, max: null },
			WWW: { uri: 'https://gedcom.io/terms/v7/WWW', min: 0, max: null }
		}
	}
} as const satisfies Readonly<Record<string, StructureSpec>>;

/** Enumeration set URI to the tags that are allowed as values. */
export const GEDCOM7_ENUM_SETS = {
	'https://gedcom.io/terms/v7/enumset-ADOP': ['BOTH', 'HUSB', 'WIFE'],
	'https://gedcom.io/terms/v7/enumset-EVEN': [
		'ADOP',
		'ANUL',
		'BAPM',
		'BARM',
		'BASM',
		'BIRT',
		'BLES',
		'BURI',
		'CENS',
		'CHR',
		'CHRA',
		'CONF',
		'CREM',
		'DEAT',
		'DIV',
		'DIVF',
		'EMIG',
		'ENGA',
		'FCOM',
		'GRAD',
		'IMMI',
		'MARB',
		'MARC',
		'MARL',
		'MARR',
		'MARS',
		'NATU',
		'ORDN',
		'PROB',
		'RETI',
		'WILL'
	],
	'https://gedcom.io/terms/v7/enumset-EVENATTR': [
		'ADOP',
		'ANUL',
		'BAPM',
		'BARM',
		'BASM',
		'BIRT',
		'BLES',
		'BURI',
		'CAST',
		'CENS',
		'CHR',
		'CHRA',
		'CONF',
		'CREM',
		'DEAT',
		'DIV',
		'DIVF',
		'DSCR',
		'EDUC',
		'EMIG',
		'ENGA',
		'EVEN',
		'FACT',
		'FCOM',
		'GRAD',
		'IDNO',
		'IMMI',
		'MARB',
		'MARC',
		'MARL',
		'MARR',
		'MARS',
		'NATI',
		'NATU',
		'NCHI',
		'NMR',
		'OCCU',
		'ORDN',
		'PROB',
		'PROP',
		'RELI',
		'RESI',
		'RETI',
		'SSN',
		'TITL',
		'WILL'
	],
	'https://gedcom.io/terms/v7/enumset-FAMC-STAT': ['CHALLENGED', 'DISPROVEN', 'PROVEN'],
	'https://gedcom.io/terms/v7/enumset-MEDI': [
		'AUDIO',
		'BOOK',
		'CARD',
		'ELECTRONIC',
		'FICHE',
		'FILM',
		'MAGAZINE',
		'MANUSCRIPT',
		'MAP',
		'NEWSPAPER',
		'OTHER',
		'PHOTO',
		'TOMBSTONE',
		'VIDEO'
	],
	'https://gedcom.io/terms/v7/enumset-NAME-TYPE': [
		'AKA',
		'BIRTH',
		'IMMIGRANT',
		'MAIDEN',
		'MARRIED',
		'OTHER',
		'PROFESSIONAL'
	],
	'https://gedcom.io/terms/v7/enumset-PEDI': ['ADOPTED', 'BIRTH', 'FOSTER', 'OTHER', 'SEALING'],
	'https://gedcom.io/terms/v7/enumset-QUAY': ['0', '1', '2', '3'],
	'https://gedcom.io/terms/v7/enumset-RESN': ['CONFIDENTIAL', 'LOCKED', 'PRIVACY'],
	'https://gedcom.io/terms/v7/enumset-ROLE': [
		'CHIL',
		'CLERGY',
		'FATH',
		'FRIEND',
		'GODP',
		'HUSB',
		'MOTH',
		'MULTIPLE',
		'NGHBR',
		'OFFICIATOR',
		'OTHER',
		'PARENT',
		'SPOU',
		'WIFE',
		'WITN'
	],
	'https://gedcom.io/terms/v7/enumset-SEX': ['F', 'M', 'U', 'X'],
	'https://gedcom.io/terms/v7/enumset-ord-STAT': [
		'BIC',
		'CANCELED',
		'CHILD',
		'COMPLETED',
		'DNS',
		'DNS_CAN',
		'EXCLUDED',
		'INFANT',
		'PRE_1970',
		'STILLBORN',
		'SUBMITTED',
		'UNCLEARED'
	]
} as const satisfies Readonly<Record<string, readonly string[]>>;

/** Level-0 structures by tag: HEAD, TRLR and the seven record types. */
export const GEDCOM7_ROOTS = {
	FAM: { uri: 'https://gedcom.io/terms/v7/record-FAM', min: 0, max: null },
	HEAD: { uri: 'https://gedcom.io/terms/v7/HEAD', min: 1, max: 1 },
	INDI: { uri: 'https://gedcom.io/terms/v7/record-INDI', min: 0, max: null },
	OBJE: { uri: 'https://gedcom.io/terms/v7/record-OBJE', min: 0, max: null },
	REPO: { uri: 'https://gedcom.io/terms/v7/record-REPO', min: 0, max: null },
	SNOTE: { uri: 'https://gedcom.io/terms/v7/record-SNOTE', min: 0, max: null },
	SOUR: { uri: 'https://gedcom.io/terms/v7/record-SOUR', min: 0, max: null },
	SUBM: { uri: 'https://gedcom.io/terms/v7/record-SUBM', min: 0, max: null },
	TRLR: { uri: 'https://gedcom.io/terms/v7/TRLR', min: 1, max: 1 }
} as const satisfies Readonly<Record<string, RootRecordSpec>>;

/** Calendar tag to its months, for date validation. */
export const GEDCOM7_CALENDARS = {
	FRENCH_R: {
		uri: 'https://gedcom.io/terms/v7/cal-FRENCH_R',
		months: [
			'VEND',
			'BRUM',
			'FRIM',
			'NIVO',
			'PLUV',
			'VENT',
			'GERM',
			'FLOR',
			'PRAI',
			'MESS',
			'THER',
			'FRUC',
			'COMP'
		]
	},
	GREGORIAN: {
		uri: 'https://gedcom.io/terms/v7/cal-GREGORIAN',
		months: ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
	},
	HEBREW: {
		uri: 'https://gedcom.io/terms/v7/cal-HEBREW',
		months: [
			'TSH',
			'CSH',
			'KSL',
			'TVT',
			'SHV',
			'ADR',
			'ADS',
			'NSN',
			'IYR',
			'SVN',
			'TMZ',
			'AAV',
			'ELL'
		]
	},
	JULIAN: {
		uri: 'https://gedcom.io/terms/v7/cal-JULIAN',
		months: ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
	}
} as const satisfies Readonly<Record<string, CalendarSpec>>;
