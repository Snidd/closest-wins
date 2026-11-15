/** Map component strings (GuessMap, RevealMap, StaticPointMap). Owned by the map agent. */
import { defineDict } from './dict.ts';
import { formatDistance as formatKm } from './format.ts';

export const map = defineDict({
	en: {
		mapLabel: 'World map. Drag to move, pinch to zoom. The cross marks your guess.',
		revealLabel: 'Map of all guesses and the correct location',
		previewLabel: 'Location preview map',
		pickHint: 'Click the map to place the point',
		crosshair: 'Your guess (map centre)',
		lockedHere: 'Locked in here',
		target: 'Correct location',
		winner: 'Winner',
		loadErrorTitle: 'The map could not be loaded',
		tilesMissing: 'The map tiles are missing on the server.',
		tilesMissingDev: 'Run scripts/fetch-map.sh to download data/map/world.pmtiles.',
		webglError: 'This browser cannot draw the map (WebGL is not available).',
		retry: 'Try again',
		km: (km: number) => formatKm(km, 'en-GB')
	},
	sv: {
		mapLabel: 'Världskarta. Dra för att flytta, nyp för att zooma. Krysset markerar din gissning.',
		revealLabel: 'Karta med alla gissningar och den rätta platsen',
		previewLabel: 'Förhandsvisning av platsen',
		pickHint: 'Klicka på kartan för att placera punkten',
		crosshair: 'Din gissning (kartans mitt)',
		lockedHere: 'Låst här',
		target: 'Rätt plats',
		winner: 'Vinnare',
		loadErrorTitle: 'Kartan kunde inte laddas',
		tilesMissing: 'Kartdata saknas på servern.',
		tilesMissingDev: 'Kör scripts/fetch-map.sh för att hämta data/map/world.pmtiles.',
		webglError: 'Den här webbläsaren kan inte rita kartan (WebGL saknas).',
		retry: 'Försök igen',
		km: (km) => formatKm(km, 'sv-SE')
	}
});
