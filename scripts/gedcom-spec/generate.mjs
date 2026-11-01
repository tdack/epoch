// Generates src/lib/server/gedcom/spec/gedcom7-spec.ts from the vendored FamilySearch GEDCOM
// data in ./source (refresh that with vendor.mjs). Offline and deterministic: running it twice
// must produce no diff.
//
// The extracted TSV files carry structure, cardinality, payload and enumeration facts; the YAML
// tag files are read only for what the TSVs leave out (the tag that spells each URI, and the
// months of each calendar). A regex over a handful of flat keys stands in for a YAML parser
// because a new dependency would buy nothing else, and the script fails loudly if a key it
// relies on goes missing.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE_DIR = join(HERE, 'source');
const OUTPUT_PATH = resolve(HERE, '../../src/lib/server/gedcom/spec/gedcom7-spec.ts');
const URI_PREFIX = 'https://gedcom.io/terms/v7/';
const XSD = 'http://www.w3.org/2001/XMLSchema#';

function fail(message) {
	throw new Error(`gedcom-spec: ${message}`);
}

function readTsv(name) {
	return readFileSync(join(SOURCE_DIR, name), 'utf8')
		.split('\n')
		.filter((line) => line.trim() !== '')
		.map((line) => line.split('\t'));
}

/** @param {string} text @param {string} key */
function scalar(text, key) {
	const match = text.match(new RegExp(`^${key}: ['"]?(.*?)['"]?\\s*$`, 'm'));
	return match ? match[1] : null;
}

/** @param {string} text @param {string} key */
function uriList(text, key) {
	const block = text.match(new RegExp(`^${key}:\\n((?:  - .*\\n)+)`, 'm'));
	if (!block) return [];
	return [...block[1].matchAll(/^ {2}- "?([^"\n]+)"?\s*$/gm)].map((m) => m[1]);
}

const tagOfUri = new Map();
const typeOfUri = new Map();
const yamlOfUri = new Map();
for (const name of readdirSync(join(SOURCE_DIR, 'tags'))) {
	const text = readFileSync(join(SOURCE_DIR, 'tags', name), 'utf8');
	const uri = scalar(text, 'uri');
	if (!uri) fail(`${name} has no uri`);
	typeOfUri.set(uri, scalar(text, 'type'));
	yamlOfUri.set(uri, text);
	const tag = scalar(text, 'standard tag');
	if (tag !== null) tagOfUri.set(uri, tag);
}

function tagOf(uri) {
	const tag = tagOfUri.get(uri);
	if (tag === undefined) fail(`no standard tag for ${uri}`);
	return tag;
}

const structureUris = [...typeOfUri].filter(([, type]) => type === 'structure').map(([u]) => u);

// Payloads. An empty second column means the structure has no payload.
const payloadOf = new Map(readTsv('payloads.tsv').map(([uri, payload]) => [uri, payload ?? '']));
const enumSetOf = new Map(readTsv('enumerations.tsv').map(([uri, set]) => [uri, set]));

function payloadSpec(uri) {
	if (!payloadOf.has(uri)) fail(`no payload row for ${uri}`);
	const payload = payloadOf.get(uri);
	const simple = {
		'': { kind: 'none' },
		[`${XSD}string`]: { kind: 'string' },
		[`${XSD}nonNegativeInteger`]: { kind: 'integer' },
		[`${XSD}anyURI`]: { kind: 'uri' },
		[`${XSD}Language`]: { kind: 'language' },
		'http://www.w3.org/ns/dcat#mediaType': { kind: 'mediaType' },
		'Y|<NULL>': { kind: 'yOrNull' },
		[`${URI_PREFIX}type-Date`]: { kind: 'dateValue' },
		[`${URI_PREFIX}type-Date#exact`]: { kind: 'dateExact' },
		[`${URI_PREFIX}type-Date#period`]: { kind: 'datePeriod' },
		[`${URI_PREFIX}type-Age`]: { kind: 'age' },
		[`${URI_PREFIX}type-List#Text`]: { kind: 'listText' },
		[`${URI_PREFIX}type-FilePath`]: { kind: 'filePath' },
		[`${URI_PREFIX}type-Latitude`]: { kind: 'latitude' },
		[`${URI_PREFIX}type-Longitude`]: { kind: 'longitude' },
		[`${URI_PREFIX}type-Name`]: { kind: 'name' },
		[`${URI_PREFIX}type-TagDef`]: { kind: 'tagDef' },
		[`${URI_PREFIX}type-Time`]: { kind: 'time' }
	};
	if (payload in simple) return simple[payload];

	const pointer = payload.match(/^@<(.+)>@$/);
	if (pointer) return { kind: 'pointer', target: pointer[1] };

	const isList = payload === `${URI_PREFIX}type-List#Enum`;
	if (isList || payload === `${URI_PREFIX}type-Enum`) {
		const enumSet = enumSetOf.get(uri);
		if (!enumSet) fail(`${uri} is an enumeration but names no enumeration set`);
		return { kind: isList ? 'listEnum' : 'enum', enumSet };
	}
	return fail(`unhandled payload ${payload} on ${uri}`);
}

// Substructures: (super, tag, sub) joined with (super, sub, cardinality).
const cardinalityOf = new Map(
	readTsv('cardinalities.tsv').map(([sup, sub, card]) => [`${sup} ${sub}`, card])
);
const subsOf = new Map();
// An empty superstructure column marks level-0 tags. CONT is listed there too, but it is the
// line-continuation pseudo-structure the parser folds away, never a root structure.
const rootRows = [];
for (const [sup, tag, sub] of readTsv('substructures.tsv')) {
	if (sup === '') {
		if (tag !== 'CONT') rootRows.push([tag, sub]);
		continue;
	}
	const card = cardinalityOf.get(`${sup} ${sub}`);
	const match = card?.match(/^\{([01]):(1|M)\}$/);
	if (!match) fail(`bad cardinality for ${sup} > ${sub}: ${card}`);
	if (!subsOf.has(sup)) subsOf.set(sup, new Map());
	if (subsOf.get(sup).has(tag)) fail(`${sup} lists tag ${tag} twice`);
	subsOf.get(sup).set(tag, {
		uri: sub,
		min: Number(match[1]),
		max: match[2] === 'M' ? null : 1
	});
}

const byKey = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const structures = {};
for (const uri of [...structureUris].sort(byKey)) {
	const subs = {};
	for (const [tag, spec] of [...(subsOf.get(uri) ?? [])].sort(([a], [b]) => byKey(a, b))) {
		if (!typeOfUri.has(spec.uri)) fail(`${uri} > ${tag} points at unknown ${spec.uri}`);
		subs[tag] = spec;
	}
	structures[uri] = { tag: tagOf(uri), payload: payloadSpec(uri), subs };
}
for (const parent of subsOf.keys()) {
	if (!(parent in structures)) fail(`substructures name an unknown parent ${parent}`);
}

// Enumeration sets, as the tags that appear in a file. Sets such as EVEN list structure URIs
// (ADOP, BAPM) whose tag is the value, so one lookup serves both.
const enumSets = {};
for (const [set, value] of readTsv('enumerationsets.tsv')) {
	(enumSets[set] ??= []).push(tagOf(value));
}
for (const set of Object.keys(enumSets)) enumSets[set].sort(byKey);
for (const spec of Object.values(structures)) {
	const set = spec.payload.enumSet;
	if (set && !(set in enumSets)) fail(`enumeration set ${set} has no values`);
}
const sortedEnumSets = Object.fromEntries(Object.entries(enumSets).sort(([a], [b]) => byKey(a, b)));

// Root level. The grammar fixes HEAD and TRLR at 1:1 and every record type at 0:M; the TSV
// files describe substructures only, so this is the one place the numbers are written by hand.
const roots = {};
for (const [tag, uri] of rootRows) {
	if (!(uri in structures)) fail(`root ${tag} points at unknown ${uri}`);
	const isSingleton = tag === 'HEAD' || tag === 'TRLR';
	roots[tag] = { uri, min: isSingleton ? 1 : 0, max: isSingleton ? 1 : null };
}
const sortedRoots = Object.fromEntries(Object.entries(roots).sort(([a], [b]) => byKey(a, b)));

const calendars = {};
for (const [uri, type] of typeOfUri) {
	if (type !== 'calendar') continue;
	const months = uriList(yamlOfUri.get(uri), 'months').map(tagOf);
	calendars[tagOf(uri)] = { uri, months };
}
const sortedCalendars = Object.fromEntries(
	Object.entries(calendars).sort(([a], [b]) => byKey(a, b))
);

const source = JSON.parse(readFileSync(join(SOURCE_DIR, 'SOURCE.json'), 'utf8'));
const literal = (value) => JSON.stringify(value);

const code = `// GENERATED FILE - DO NOT EDIT.
// Source: ${source.repository}
// Release: ${source.tag}, commit ${source.commit}
// Licence: ${source.license} (see scripts/gedcom-spec/source/LICENSE and NOTICE)
// Regenerate with \`npm run gedcom:spec\`; refresh the vendored data with
// \`node scripts/gedcom-spec/vendor.mjs <tag>\` first.
import type {
	CalendarSpec,
	RootRecordSpec,
	StructureSpec
} from './types';

export const GEDCOM7_SPEC_RELEASE = ${literal({ tag: source.tag, commit: source.commit })} as const;

/** Every structure type, keyed by URI. */
export const GEDCOM7_STRUCTURES = ${literal(structures)} as const satisfies Readonly<Record<string, StructureSpec>>;

/** Enumeration set URI to the tags that are allowed as values. */
export const GEDCOM7_ENUM_SETS = ${literal(sortedEnumSets)} as const satisfies Readonly<Record<string, readonly string[]>>;

/** Level-0 structures by tag: HEAD, TRLR and the seven record types. */
export const GEDCOM7_ROOTS = ${literal(sortedRoots)} as const satisfies Readonly<Record<string, RootRecordSpec>>;

/** Calendar tag to its months, for date validation. */
export const GEDCOM7_CALENDARS = ${literal(sortedCalendars)} as const satisfies Readonly<Record<string, CalendarSpec>>;
`;

const config = (await prettier.resolveConfig(OUTPUT_PATH)) ?? {};
const formatted = await prettier.format(code, {
	...config,
	plugins: [],
	filepath: OUTPUT_PATH
});
writeFileSync(OUTPUT_PATH, formatted);
console.log(
	`Wrote ${OUTPUT_PATH}: ${Object.keys(structures).length} structures, ` +
		`${Object.keys(sortedEnumSets).length} enumeration sets, ${source.tag}`
);
