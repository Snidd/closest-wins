import { describe, expect, it } from 'vitest';
import { parseCoordinates } from './coords.ts';

const close = (got: { lat: number; lng: number } | null, lat: number, lng: number) => {
	expect(got).not.toBeNull();
	expect(got!.lat).toBeCloseTo(lat, 4);
	expect(got!.lng).toBeCloseTo(lng, 4);
};

describe('parseCoordinates', () => {
	it.each([
		['48.8584, 2.2945', 48.8584, 2.2945],
		['48.8584,2.2945', 48.8584, 2.2945],
		['48.8584 2.2945', 48.8584, 2.2945],
		['  -33.8568;151.2153  ', -33.8568, 151.2153],
		['(40.6892, -74.0445)', 40.6892, -74.0445],
		['48.8584°, 2.2945°', 48.8584, 2.2945],
		['59,3293 18,0686', 59.3293, 18.0686],
		['59,3293; 18,0686', 59.3293, 18.0686],
		['-90, 180', -90, 180]
	])('decimal pair %s', (text, lat, lng) => close(parseCoordinates(text), lat, lng));

	it.each([
		['48°51′30″N 2°17′40″E', 48.858333, 2.294444],
		['48°51′30″N, 2°17′40″E', 48.858333, 2.294444],
		[`48° 51' 30.5" N, 2° 17' 40" E`, 48.858472, 2.294444],
		['48°51′N 2°17′E', 48.85, 2.283333],
		['33°51′25″S 151°12′55″E', -33.856944, 151.215278],
		['40°41′21″N 74°2′40″W', 40.689167, -74.044444],
		["40°41'21''N 74°2'40''W", 40.689167, -74.044444],
		['22º 57′ 06″ S 43º 12′ 40″ W', -22.951667, -43.211111],
		['2°17′40″E 48°51′30″N', 48.858333, 2.294444]
	])('DMS %s', (text, lat, lng) => close(parseCoordinates(text), lat, lng));

	it.each([
		['48.8584N 2.2945E', 48.8584, 2.2945],
		['48.8584 N, 2.2945 E', 48.8584, 2.2945],
		['48.8584° N, 2.2945° W', 48.8584, -2.2945],
		['48.8584°N 2.2945°E', 48.8584, 2.2945],
		['n 48.8584 e 2.2945', 48.8584, 2.2945],
		['S 33.8568 E 151.2153', -33.8568, 151.2153],
		['67,8557N 18,5300E', 67.8557, 18.53]
	])('hemisphere %s', (text, lat, lng) => close(parseCoordinates(text), lat, lng));

	it('takes the first parseable part of a Wikipedia coordinate string', () => {
		close(parseCoordinates('48°51′30″N 2°17′40″E / 48.858222°N 2.294500°E / 48.858222; 2.294500'), 48.858333, 2.294444);
		close(parseCoordinates('Coordinates: 48°51′N / 48.858222; 2.294500'), 48.858222, 2.2945);
	});

	it.each([
		[
			'https://www.google.com/maps/place/Eiffel+Tower/@48.8583701,2.2919064,17z/data=!3m1!4b1!4m6!3m5!1s0x47e66e2964e34e2d:0x8ddca9ee380ef7e0!8m2!3d48.8583701!4d2.2944813!16zL20vMDJqODE',
			48.8583701,
			2.2944813
		],
		['https://www.google.com/maps/@59.3293235,18.0685808,15z', 59.3293235, 18.0685808],
		['https://www.google.se/maps/@-33.8567844,151.213108,3a,75y,90t/data=!3m6', -33.8567844, 151.213108],
		['https://maps.google.com/?q=40.689247,-74.044502', 40.689247, -74.044502],
		['https://www.google.com/maps/search/?api=1&query=47.5951518%2C-122.3316393', 47.5951518, -122.3316393],
		['https://www.google.com/maps?ll=35.6586,139.7454&z=16', 35.6586, 139.7454]
	])('Google Maps URL %#', (text, lat, lng) => close(parseCoordinates(text), lat, lng));

	it.each([
		'',
		'   ',
		'Eiffel Tower',
		'48.8584',
		'91, 10',
		'10, 181',
		'48°61′N 2°17′E',
		'48°51′N 2°17′N',
		'48.5°30′N 2°E',
		'https://www.google.com/maps/place/Eiffel+Tower',
		'1, 2, 3'
	])('rejects %j', (text) => {
		expect(parseCoordinates(text)).toBeNull();
	});
});
