/**
 * Builds `tvos/ClosestWins/Resources/shared.json`: the strings, colours and timings the native
 * Apple TV app shares with the web TV (`pnpm tvos:export` writes it, `shared.test.ts` fails when
 * the committed file is out of date). Pure: no I/O, no environment.
 *
 * Dictionary messages that are functions on the web are exported as templates with named
 * placeholders, derived by calling the real function and then checked against it for a grid of
 * arguments (see `messageEntry`), so the Swift side renders exactly what the web renders:
 *
 * ```json
 * "lockedIn": { "params": ["n", "total"], "template": "{n} of {total} locked in" }
 * "guessCount": { "params": ["n"], "template": "{n} guesses", "cases": [{ "when": { "n": 1 }, "template": "1 guess" }] }
 * "km": { "params": ["km"], "format": "distance" }
 * ```
 *
 * Render: take the first case whose `when` values all equal the arguments, else `template`;
 * replace each `{name}` with the argument (integers as plain digits, strings as given).
 */
import { common } from '../../src/lib/i18n/common.ts';
import { tv } from '../../src/lib/i18n/tv.ts';
import { formatDistance } from '../../src/lib/i18n/format.ts';
import { LOCALES, type Locale } from '../../src/lib/i18n/locale.ts';
import { PLAYER_COLORS, textColorOn } from '../../src/lib/ui/colors.ts';
import { MAX_ZOOM, MIN_ZOOM, TILE_MAX_ZOOM, WORLD_VIEW } from '../../src/lib/map/config.ts';
import { REVEAL_FLY_MS, REVEAL_LINES_MS, REVEAL_STAGES } from '../../src/lib/map/reveal.ts';
import {
	JOIN_CODE_LENGTH,
	MAX_PLAYERS,
	PAIRING_CODE_LENGTH,
	PAIRING_CODE_TTL_MS,
	PHOTO_SIZES
} from '../../src/lib/game/types.ts';

/**
 * Format version of shared.json. Bump it when the structure changes in a way an existing Swift
 * reader would misread (renamed or retyped fields); adding keys does not need a bump.
 */
export const SHARED_VERSION = 2;

/** Repo-relative path of the generated file. */
export const SHARED_JSON_PATH = 'tvos/ClosestWins/Resources/shared.json';

export type MessageArgs = Record<string, string | number>;

export interface TemplateMessage {
	params: string[];
	template: string;
	/** Checked in order; the first whose `when` values all equal the arguments wins. */
	cases?: Array<{ when: Record<string, number>; template: string }>;
}

/** A distance in km, formatted by the rules in `distanceFormat`. */
export interface DistanceMessage {
	params: [string];
	format: 'distance';
}

export type MessageEntry = string | TemplateMessage | DistanceMessage;

type AnyFn = (...args: unknown[]) => string;
type RawDict = Record<Locale, Record<string, string | AnyFn>>;

const DICTS = { common, tv } as unknown as Record<string, RawDict>;

/**
 * Function messages that cannot be a template. `distance`: the message is `formatDistance`
 * (checked below). `omit`: left out of shared.json, with the reason recorded in the file.
 */
const SPECIAL: Record<string, Record<string, { kind: 'distance' } | { kind: 'omit'; reason: string }>> = {
	common: {
		km: { kind: 'distance' },
		tooManyAttempts: {
			kind: 'omit',
			reason: 'Converts seconds to whole minutes (Math.ceil); login only, never shown on the TV.'
		}
	}
};

/**
 * Web-only strings, not exported at all: the phones' team strings, which the Apple TV app never
 * shows. Move a key out of here (and run `pnpm tvos:export`) once the app uses it.
 */
export const WEB_ONLY: Record<string, ReadonlySet<string>> = {
	common: new Set(['team', 'chooseTeam', 'teamRequired', 'teamPlayers', 'teamWins', 'teamsShareWin'])
};

const DISTANCE_LOCALES = { en: 'en-GB', sv: 'sv-SE' } as const satisfies Record<Locale, string>;
/** Sample distances (km) covering every branch of `formatDistance`, exported as test cases. */
const DISTANCE_SAMPLES = [0, 0.004, 0.0149, 0.42, 0.995, 1, 3.25, 9.96, 12.6, 999.5, 1234.4, 19_999.9];

/** Argument values every template is checked with (cartesian over the parameters). */
const CHECK_VALUES = [0, 1, 2, 3, 5, 10, 11, 21, 100, 1234];

/** Parameter names of an arrow function, from its source. */
function paramNames(fn: AnyFn, where: string): string[] {
	const m = /^\s*(?:\(([^)]*)\)|([A-Za-z_$][\w$]*))\s*=>/.exec(fn.toString());
	if (!m) throw new Error(`${where}: cannot read the parameter names of ${fn.toString().slice(0, 60)}`);
	const names = (m[1] ?? m[2] ?? '')
		.split(',')
		.map((s) => s.replace(/[:=?].*$/s, '').trim())
		.filter(Boolean);
	if (names.length !== fn.length) throw new Error(`${where}: expected ${fn.length} parameters, read ${names.join(', ')}`);
	return names;
}

function fill(template: string, args: MessageArgs): string {
	return template.replace(/\{(\w+)\}/g, (all, name: string) => (name in args ? String(args[name]) : all));
}

/** Renders an exported message the way the Swift client must. */
export function renderMessage(entry: MessageEntry, args: MessageArgs = {}, locale: Locale = 'en'): string {
	if (typeof entry === 'string') return entry;
	if ('format' in entry) return formatDistance(Number(args[entry.params[0]]), DISTANCE_LOCALES[locale]);
	const hit = entry.cases?.find((c) => Object.entries(c.when).every(([k, v]) => args[k] === v));
	return fill(hit?.template ?? entry.template, args);
}

function* argGrid(names: string[]): Generator<MessageArgs> {
	if (names.length === 0) {
		yield {};
		return;
	}
	const [first, ...rest] = names;
	for (const v of CHECK_VALUES) for (const r of argGrid(rest)) yield { [first!]: v, ...r };
}

/**
 * The template form of a function message: called with `{name}` placeholders for the default
 * template, and with 0, 1 and 2 for one parameter at a time to find special cases (plurals).
 * Throws unless the result reproduces the function for every argument combination in the grid.
 */
function templateEntry(fn: AnyFn, names: string[], where: string): TemplateMessage {
	const placeholders: MessageArgs = Object.fromEntries(names.map((n) => [n, `{${n}}`]));
	const call = (args: MessageArgs) => fn(...names.map((n) => args[n]));
	const entry: TemplateMessage = { params: names, template: call(placeholders) };
	const cases: NonNullable<TemplateMessage['cases']> = [];
	for (const name of names) {
		for (const v of [0, 1, 2]) {
			const args = { ...placeholders, [name]: v };
			const out = call(args);
			if (out !== fill(entry.template, args)) cases.push({ when: { [name]: v }, template: out });
		}
	}
	if (cases.length) entry.cases = cases;
	for (const args of argGrid(names)) {
		const want = call(args);
		const got = renderMessage(entry, args);
		if (got !== want) {
			throw new Error(
				`${where} cannot be exported as a template (for ${JSON.stringify(args)} the web says ` +
					`${JSON.stringify(want)}, the template gives ${JSON.stringify(got)}). ` +
					`Handle it in SPECIAL in scripts/tvos/shared.ts.`
			);
		}
	}
	return entry;
}

function exportDict(dictName: string, locale: Locale, omitted: OmittedString[]): Record<string, MessageEntry> {
	const dict = DICTS[dictName]!;
	const out: Record<string, MessageEntry> = {};
	for (const [key, value] of Object.entries(dict[locale])) {
		const where = `${dictName}.${locale}.${key}`;
		if (WEB_ONLY[dictName]?.has(key)) continue;
		if (typeof value === 'string') {
			out[key] = value;
			continue;
		}
		// Parameter names come from the English function (Swedish has the same signature).
		const names = paramNames(dict.en[key] as AnyFn, where);
		const special = SPECIAL[dictName]?.[key];
		if (special?.kind === 'omit') {
			if (locale === 'en') omitted.push({ dict: dictName, key, params: names, reason: special.reason });
			continue;
		}
		if (special?.kind === 'distance') {
			for (const km of DISTANCE_SAMPLES) {
				if (value(km) !== formatDistance(km, DISTANCE_LOCALES[locale])) {
					throw new Error(`${where} is no longer formatDistance (differs for ${km})`);
				}
			}
			out[key] = { params: [names[0]!], format: 'distance' };
			continue;
		}
		out[key] = templateEntry(value, names, where);
	}
	return out;
}

interface OmittedString {
	dict: string;
	key: string;
	params: string[];
	reason: string;
}

export function buildShared() {
	const omitted: OmittedString[] = [];
	const strings: Record<string, Record<Locale, Record<string, MessageEntry>>> = {};
	for (const name of Object.keys(DICTS)) {
		strings[name] = { en: exportDict(name, 'en', omitted), sv: exportDict(name, 'sv', omitted) };
	}
	return {
		$comment:
			'Generated by `pnpm tvos:export` from the web code (scripts/tvos/shared.ts). Do not edit by hand.',
		version: SHARED_VERSION,
		locales: [...LOCALES],
		strings,
		omittedStrings: omitted,
		distanceFormat: {
			rule:
				'km < 1: metres = max(10, round(km * 1000 / 10) * 10), grouped, + " m". ' +
				'1 <= km < 10: exactly one decimal, + " km". km >= 10: whole km (rounded), grouped, + " km". ' +
				'All rounding is half away from zero (3.25 -> 3.3; not banker\'s rounding). ' +
				'Grouping and decimal separator follow the locale (sv-SE groups with U+00A0 and uses a decimal comma). ' +
				'The examples are the web output; a client must reproduce every one.',
			locales: DISTANCE_LOCALES,
			examples: Object.fromEntries(
				LOCALES.map((l) => [l, DISTANCE_SAMPLES.map((km) => ({ km, text: formatDistance(km, DISTANCE_LOCALES[l]) }))])
			)
		},
		playerColors: PLAYER_COLORS.map((hex) => ({ hex, text: textColorOn(hex) })),
		reveal: {
			stages: [...REVEAL_STAGES],
			flyMs: REVEAL_FLY_MS,
			linesMs: REVEAL_LINES_MS
		},
		map: {
			maxZoom: MAX_ZOOM,
			minZoom: MIN_ZOOM,
			tileMaxZoom: TILE_MAX_ZOOM,
			worldView: { lng: WORLD_VIEW.center[0], lat: WORLD_VIEW.center[1], zoom: WORLD_VIEW.zoom }
		},
		pairing: { codeLength: PAIRING_CODE_LENGTH, codeTtlMs: PAIRING_CODE_TTL_MS },
		game: { joinCodeLength: JOIN_CODE_LENGTH, maxPlayers: MAX_PLAYERS },
		photoSizes: { ...PHOTO_SIZES }
	};
}

/** The exact file contents (tab-indented JSON, trailing newline). */
export function serializeShared(): string {
	return `${JSON.stringify(buildShared(), null, '\t')}\n`;
}
