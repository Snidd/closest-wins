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
   Optionally **teams** (off by default): 2 to 8 teams, each with an optional name (a blank name
   shows as "Team 2" / "Lag 2"), and whether players pick their own team. Team settings cannot
   be changed after the game is created.
2. **Pair the TV.** The TV opens `/tv` and shows a short pairing code. The host types or scans
   it, and the TV becomes that game's big screen.
3. **Join.** The TV shows a QR code and a short join code. Players scan, type a nickname
   (unique in the game, about 16 characters max) and get an automatically assigned pin colour.
   In a teams game, players either pick a team on the join page (when the host allowed it) or
   are placed on the team with the fewest players (lowest team number on a tie); late joiners
   follow the same rule. A player's team never changes after joining.
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
- **Teams:** everyone still guesses alone. A round goes to the team of the closest player:
  1 point per team, even when two of its players tie for closest; players of different teams
  tying give each of their teams the point. A kicked player's round wins no longer count for
  their team, and a team without active players is left out of the standings. The game winner
  is the team with the most rounds won. A tie between teams at the end sends every active
  member of the tied teams into sudden death (everyone else watches), repeated until one team
  is ahead; with no unused location left the tied teams share the win.

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
- The native Apple TV app currently overrides the game language and always shows Swedish, behind
  a build-time flag (`forcedLanguage`). The web big screen still follows the host's choice.

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
- Teams in the admin game history (it shows players only for now), team colours on pins, and
  changing a player's team or the team settings after creation.

## Open questions

- Maximum zoom level and how much relief detail the map shows.
- Player limit per game (the reveal shows all pins at once, so very large rooms may clutter).
- Join code and pairing code format and lifetime.
- Whether the admin UI should warn when a playlist's locations lack one of the two languages.

## Implementation notes

Decisions that changed or were settled while building it:

- **One login page.** Admin and host share `/login` (`?next=` returns to where you were) instead
  of separate login screens.
- **Admin places points itself.** Locations get their point by pasted coordinates (or a maps
  link) or a click on our own labels-free map; there is no geocoding or external map service.
- **Engine timing guards.** The round timer fires shortly after the deadline so a last cross
  position still counts; a disconnect only affects the "everyone locked in" early finish after a
  short grace; after a server restart phones get a few seconds to reconnect before it applies; a
  running round keeps its deadline across restarts.
- **Nobody wins if nobody won a round.** A game where no round had a winner ends without a winner
  rather than a shared win between everyone.
- **The TV re-pairs after a game.** When a game finishes, the big screen shows a new pairing code
  next to the final standings, so the host can pair the same screen with the next game.
- **Phones wait for the TV.** A phone shows the answer and its own result at the moment the big
  screen shows the place name, not earlier.
