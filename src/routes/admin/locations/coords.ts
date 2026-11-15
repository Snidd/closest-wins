/**
 * Parses coordinates in the formats people copy from Google Maps, Wikipedia and friends:
 *
 * - decimal pairs: `48.8584, 2.2945` · `48.8584 2.2945` · `-33.86;151.21` · `59,3293 18,0686`
 * - degrees/minutes/seconds: `48°51′30″N 2°17′40″E` · `48° 51' 30.5" N, 2° 17' 40" E` · `48°51′N 2°17′E`
 * - decimal with hemisphere: `48.8584N 2.2945E` · `48.8584° N, 2.2945° W` · `N 48.8584 E 2.2945`
 * - Wikipedia's combined string `48°51′29″N 2°17′40″E / 48.858; 2.294` (first parseable part)
 * - Google Maps URLs: the place pin `!3d<lat>!4d<lng>`, else the view centre `@<lat>,<lng>,<zoom>z`,
 *   else `?q=` / `ll=` / `query=` / `center=` / `destination=` with `<lat>,<lng>`.
 *
 * Returns null when nothing sensible is found or the values are out of range.
 */
export interface LatLng {
	lat: number;
	lng: number;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

function valid(lat: number, lng: number): LatLng | null {
	if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
	if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
	return { lat: round6(lat), lng: round6(lng) };
}

const num = (s: string | undefined) => (s === undefined ? 0 : Number(s.replace(',', '.')));

function fromUrl(text: string): LatLng | null {
	let decoded = text;
	try {
		decoded = decodeURIComponent(text);
	} catch {
		// keep raw
	}
	const D = '(-?\\d{1,3}(?:\\.\\d+)?)';
	const pin = new RegExp(`!3d${D}!4d${D}`).exec(decoded);
	if (pin) return valid(Number(pin[1]), Number(pin[2]));
	const at = new RegExp(`@${D},${D}`).exec(decoded);
	if (at) return valid(Number(at[1]), Number(at[2]));
	const param = new RegExp(`[?&](?:q|ll|query|center|destination|daddr|sll)=(?:loc:)?${D},\\s*${D}`).exec(decoded);
	if (param) return valid(Number(param[1]), Number(param[2]));
	return null;
}

/** Unicode primes/quotes/degree look-alikes → ASCII `'`, `"` and `°`. */
function normalize(s: string): string {
	return s
		.replace(/[′’‘`´]/g, "'")
		.replace(/[″”“]/g, '"')
		.replace(/''/g, '"')
		.replace(/[º˚]/g, '°')
		.replace(/\u00a0/g, ' ')
		.trim()
		.toUpperCase();
}

const N = '(\\d{1,3}(?:[.,]\\d+)?)';
const M = '(\\d{1,2}(?:[.,]\\d+)?)';
/** degrees [° ] [minutes '] [seconds "] */
const DMS = `${N}\\s*°?\\s*(?:${M}\\s*'\\s*)?(?:${M}\\s*"\\s*)?`;
const SEP = '\\s*[,;/]?\\s*';
const SUFFIX = new RegExp(`^${DMS}([NSEW])${SEP}${DMS}([NSEW])\\.?$`);
const PREFIX = new RegExp(`^([NSEW])\\s*${DMS}${SEP}([NSEW])\\s*${DMS}$`);

type Part = { deg: string; min?: string; sec?: string; hemi: string };

function toDecimal(p: Part): number | null {
	const deg = num(p.deg);
	const min = num(p.min);
	const sec = num(p.sec);
	if (min >= 60 || sec >= 60) return null;
	// Minutes/seconds only make sense with whole degrees (and seconds with whole minutes).
	if ((p.min !== undefined && !Number.isInteger(deg)) || (p.sec !== undefined && !Number.isInteger(min))) {
		return null;
	}
	const value = deg + min / 60 + sec / 3600;
	return p.hemi === 'S' || p.hemi === 'W' ? -value : value;
}

function fromHemispheres(a: Part, b: Part): LatLng | null {
	const isLat = (h: string) => h === 'N' || h === 'S';
	if (isLat(a.hemi) === isLat(b.hemi)) return null;
	const [latPart, lngPart] = isLat(a.hemi) ? [a, b] : [b, a];
	const lat = toDecimal(latPart);
	const lng = toDecimal(lngPart);
	if (lat === null || lng === null) return null;
	return valid(lat, lng);
}

function fromText(raw: string): LatLng | null {
	const s = normalize(raw);
	if (!s) return null;

	let m = SUFFIX.exec(s);
	if (m) {
		return fromHemispheres(
			{ deg: m[1]!, min: m[2], sec: m[3], hemi: m[4]! },
			{ deg: m[5]!, min: m[6], sec: m[7], hemi: m[8]! }
		);
	}
	m = PREFIX.exec(s);
	if (m) {
		return fromHemispheres(
			{ hemi: m[1]!, deg: m[2]!, min: m[3], sec: m[4] },
			{ hemi: m[5]!, deg: m[6]!, min: m[7], sec: m[8] }
		);
	}

	// Signed decimal pair with a dot decimal separator: "48.85, 2.29", "-33.8 151.2", "48.8°, 2.2°".
	m = /^\(?\s*(-?\d{1,3}(?:\.\d+)?)\s*°?\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*°?\s*\)?$/.exec(s);
	if (m) return valid(Number(m[1]), Number(m[2]));
	// Decimal commas (Swedish locale), separated by whitespace or a semicolon: "59,3293 18,0686".
	m = /^(-?\d{1,3},\d+)\s*[;\s]\s*(-?\d{1,3},\d+)$/.exec(s);
	if (m) return valid(num(m[1]), num(m[2]));
	return null;
}

export function parseCoordinates(input: string): LatLng | null {
	const text = input.trim();
	if (!text) return null;
	if (/^https?:\/\//i.test(text) || /google\.[a-z.]+\/maps|goo\.gl|maps\.app/i.test(text)) {
		return fromUrl(text);
	}
	const whole = fromText(text);
	if (whole) return whole;
	// Wikipedia: "DMS / decimal-with-hemisphere / signed decimal" — take the first that parses.
	for (const part of text.split(/\s+\/\s+|\s*\|\s*/)) {
		const parsed = fromText(part);
		if (parsed) return parsed;
	}
	return null;
}
