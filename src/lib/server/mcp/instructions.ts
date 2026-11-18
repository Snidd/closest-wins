/** Server identity and the briefing a connecting agent receives in `initialize`. */
import { MAX_LOCATION_LAT } from '#lib/geo.ts';

export const SERVER_INFO = { name: 'closest-wins-content', title: 'Closest Wins content', version: '1.0.0' } as const;

export const INSTRUCTIONS = `\
Closest Wins (Swedish: "Närmast vinner") is a party map-guessing game. Each round, players see a clue (a photo and/or a short text) and place a cross on a blank world map: land, water, relief and country borders only, no labels, cities or roads. Whoever is closest to the real point wins the round (great-circle distance in km). This server manages the game CONTENT only: locations and playlists. It cannot create or control games.

LOCATIONS
- lat/lng is the answer. It must be the precise point of the place (the building, summit, waterfall, square), in WGS84 decimal degrees with about 4-5 decimals, never a city centre or a rough guess. Double-check the sign: south and west are negative. Latitude must lie between -${MAX_LOCATION_LAT} and ${MAX_LOCATION_LAT}: the game map cannot show the poles, so pick a point within that range (e.g. the North Pole is not possible). For a large target (a country, lake, desert, mountain range) pick one representative point and mention it in the fact.
- Players see ONLY the clue during the round (the photo and/or clueText). The name and the fact are shown after the reveal. So the clue must not contain the name or an obvious giveaway (no place names, no captions or signs naming it). A good clue can be reasoned about: landscape, vegetation, architecture, climate, a script on signs, a riddle-like description. Prefer recognisable places that are fun to locate on a map without labels.
- Fields: name (what the place is called, shown at the reveal); clueText (shown during the round; optional when there is a photo); fact (optional, 1-3 short, true and surprising sentences shown at the reveal); photo (optional clue image).
- Rules: a location needs a name in at least one language and a clue (a photo, a clue text, or both).
- startView (optional { lat, lng, zoom }) is where the players' maps open during the round instead of the whole world. It is a hint, so keep it fair: frame a region such as the country (zoom about 4-5), never centre it on the answer point. Leave it out to start from the whole world.
- Photos are imported from a URL (create_location's "photo" field or attach_photo_from_url): the server downloads the image, strips its metadata and stores its own copies. Use a direct link to the image file (e.g. upload.wikimedia.org; Wikimedia thumbnails only exist at standard widths such as 330px, 500px, 960px or 1280px, other widths fail), choose images whose license allows reuse, and fill in attribution (author and license) and sourceUrl (the page describing the image).

LANGUAGES
- Every text has a Swedish variant (fields ending in Sv) and an English one (ending in En). At least one is required and the game falls back to the other, but write both whenever you can. Write natural, idiomatic Swedish (with å, ä, ö) rather than a word-for-word translation, and use the established Swedish name of a place where one exists (e.g. "Eiffeltornet", "Kinesiska muren").
- find_missing_translations lists the texts that still lack a language, including the existing text to translate; fix them with update_location / update_playlist.

PLAYLISTS
- A playlist is an ordered list of locations (play order) with a default round timer in seconds (5-600, usually 30-60). A location can be in many playlists. A good playlist has a theme, a mix of difficulty and spread across the map.

WORKING EFFICIENTLY
- Search with list_locations before creating, to avoid duplicates.
- create_locations creates up to 25 locations in one call and reports success or an error per item. Then put the returned ids in a playlist with create_playlist (locationIds), set_playlist_locations (full ordered list) or add_locations_to_playlist.
- Update tools change only the fields you send; null or "" clears a field.
- A location that has been played in a game cannot be deleted (game history keeps it); remove it from the playlist instead.
- Ids are uuids returned by the tools; never invent them.`;
