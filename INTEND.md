# Closest Wins / Närmast vinner — Intent

What we are building and the choices made so far. Decisions marked **(assumed)** were not
explicitly discussed; they are defaults to challenge, not settled facts.

## The game

A party game played in one room. Everyone sees a clue (a photo and/or a text), then scrolls a
world map on their own phone and places a cross where they think the place is. Whoever is
closest to the real point wins the round.

- **English name:** Closest Wins. **Swedish name:** Närmast vinner.
- A game has three kinds of screens: players' phones, the host's phone, and one big shared
  screen (TV).

## Screens and roles

| Surface | Device | Login | Purpose |
|---|---|---|---|
| Player | Phone (mobile first) | None, nickname only | See the clue, place the cross, lock in |
| Host controller | Host's phone | Admin password | Create and run the game (game master) |
| Big screen (`/tv`) | TV / laptop on HDMI | None, paired by code | Join QR, clue, timer, reveal, standings |
| Admin | Desktop browser | Admin password | Manage locations and playlists |
| MCP server | Agent | Separate bearer token | Help create locations and playlists |

- **The host never plays.** The host phone shows controls only (start, next, skip, kick).
- The big screen is display only. It never takes input beyond pairing and never sees the password.

## Game flow

1. **Create.** The host logs in on their phone with the admin password, picks a playlist and
   creates a game. Options, with defaults from the playlist: number of rounds (first N or
   random N), shuffle on/off, seconds per round, and the game language for the big screen.
2. **Pair the TV.** The TV opens `/tv` and shows a short pairing code. The host types or scans
   it, and the TV becomes that game's big screen.
3. **Join.** The TV shows a QR code and a short join code. Players scan, type a nickname
   (unique in the game, about 16 characters max) and get an automatically assigned pin colour.
4. **Round.** The clue is shown on the TV and on every phone (collapsible over the map on
   phones). A countdown runs. Players pan and zoom, then press "Lock in".
5. **Round end.** The round ends when the timer hits zero or when every connected player has
   locked in.
6. **Reveal** on the TV (see below), then the host advances to the next round.
7. **Game end.** Final standings on the TV, with sudden death if needed.

### Guessing rules

- The map resets to the full world view at the start of every round.
- A locked-in guess is final for that round **(assumed)**.
- If the timer runs out without a lock-in, the position under the cross counts, but only if
  the player panned or zoomed at least once that round. A player who never touched the map has
  no guess and cannot win the round.
- Distance is great-circle (haversine) kilometres from the cross to the location's point.

### Scoring

- **Winner takes the round:** the closest player gets 1 point. Nobody else scores.
- If nobody made a guess, nobody scores **(assumed)**. An exact distance tie gives each tied
  player the point **(assumed)**.
- The game winner is the player with the most rounds won.
- **Tie at the end: sudden death.** Only the tied leaders play an extra round on a random
  location from the library that was not used in this game. Repeat until one leader is closer.
  If the library has no unused locations left, the tied players share the win **(assumed)**.
- Total distance over the game is recorded and shown as a stat, but does not decide the winner.

### Reveal

All guesses appear on the TV world map at once (pin colour and nickname). After a beat of
suspense the camera flies to the real point, lines are drawn from each pin with the distance
in km, the round winner is crowned and the location's name and fact text are shown. The host
can skip ahead. Phones show the player's own distance and placement once the TV has revealed
the answer **(assumed)**.

### Players coming and going

- Late joining is allowed between rounds; a late player starts at 0 points.
- A token stored on the phone restores the same player after a refresh or lost connection.
- Disconnected players are shown greyed out and do not block the "everyone locked in" early
  finish.
- The host can kick players (also the remedy for offensive nicknames).

## The map

- MapLibre GL with self-hosted vector tiles (Protomaps / PMTiles) and our own style.
- Drawn: land, oceans, lakes, major rivers, relief/landcover tint and country borders.
- Not drawn: any text, cities, roads or other man-made features.
- Phone interaction: one finger pans, pinch zooms, a fixed cross in the centre of the screen
  marks the chosen point. No rotation or tilt **(assumed)**.
- Maximum zoom is capped at a level where the missing detail does not make the map blank;
  the exact level is to be tuned in play testing **(assumed)**.
- The same style is used on the TV for the reveal.

## Content

- **Location:** one point (lat/lng), a name, one clue made of an optional photo and an optional
  text (at least one of them), and an optional fact text for the reveal. For large targets
  (a country, a lake) the author picks a representative point.
- **Playlist:** a name, an ordered list of locations and a default round timer. A location can
  appear in many playlists.
- **Photos:** uploaded in the admin UI or imported from a URL (the route the MCP server uses).
  The server downloads the image, strips EXIF/GPS data, resizes to a few WebP sizes and stores
  them on a mounted disk volume. Source and attribution are recorded with each photo. Nothing
  is hotlinked at game time.

## Languages

- UI in Swedish and English. Swedish is used when the device locale is Swedish, otherwise
  English.
- Content text (names, clue text, fact text) has a Swedish and an English variant. At least
  one must be filled in; the other falls back to it.
- Phones use their own device locale. The big screen uses the game language chosen by the host
  at creation, defaulting to the host phone's locale.

## Access

- **One shared admin password** (from environment configuration) unlocks both the admin UI and
  hosting. There is no user table and no per-person ownership of content.
- **Players have no accounts**, only a nickname and a reconnect token per game.
- **MCP uses its own bearer token**, separate from the admin password.

## MCP server

An HTTP MCP endpoint served by the same app (`/mcp`). Tools cover full content management:
list, search, create, update and delete locations and playlists, including translations and
attaching a photo by URL. There are no game-control tools.

## Technical choices

- **App:** SvelteKit 3 with Svelte 5 (runes, async, remote functions), TypeScript, pnpm.
- **Database:** Postgres through Drizzle ORM.
- **Deployment:** a single long-running Node process (Node adapter, Docker) next to Postgres on
  our own server. The current `adapter-auto` is to be replaced with the Node adapter.
- **Realtime:** game state, guesses and scores are written to Postgres as they happen, and the
  one Node process fans changes out to TV, host and phones over server-sent events. A restart
  mid-game can resume. Single instance only; no external realtime service.
- **History:** finished games and their results are kept.
- **Tests:** Playwright end-to-end tests (already in the scaffold).

## Out of scope for now

- Public sign-up, per-user accounts and content ownership.
- The host playing as a contestant.
- Area or polygon targets, bullseye radii, multiple clue variants and progressive hints.
- Satellite imagery and per-playlist map styles.
- Mixing several playlists in one game.
- Agent-driven game control through MCP.
- Multi-instance or serverless deployment.

## Open questions

- Maximum zoom level and how much relief detail the map shows.
- Player limit per game (the reveal shows all pins at once, so very large rooms may clutter).
- Join code and pairing code format and lifetime.
- Whether the admin UI should warn when a playlist's locations lack one of the two languages.
