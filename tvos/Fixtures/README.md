# TV snapshot fixtures

One JSON file per state of the TV stream: each is a `TvStateValue` (`src/lib/game/types.ts`)
exactly as the server's view code (`buildTvState` in `src/lib/server/game/views.ts`) yields it.
The Swift decoding tests decode every file here.

| File | State |
| --- | --- |
| `unregistered.json` | no TV token yet |
| `pairing.json` | pairing code and expiry |
| `lobby.json` | paired, waiting for players (one disconnected) |
| `round-photo.json` | round with a photo-only clue, one player locked in |
| `round-text.json` | round with a text-only clue, a late joiner watching |
| `round-photo-text.json` | round with photo and text clue |
| `round-sudden-death.json` | sudden-death round between two tied leaders (Swedish game) |
| `reveal.json` | reveal with target, guesses and photo credit |
| `reveal-skipped.json` | reveal the host skipped |
| `standings.json` | standings, next step: a regular round |
| `standings-sudden-death.json` | standings, next step: sudden death |
| `standings-final.json` | standings, next step: finish |
| `finished.json` | final standings with `nextPairing` |
| `lobby-teams.json` | teams game lobby: two teams (one custom name, one default), one player disconnected |
| `round-teams.json` | teams game round, one player locked in |
| `reveal-teams.json` | teams game reveal with `winnerTeams` and `teamStandings` |
| `standings-teams.json` | teams game standings, next step: a regular round |
| `standings-teams-sudden-death.json` | teams tied, next step: sudden death between both teams |
| `round-teams-sudden-death.json` | the teams' sudden-death round |
| `finished-teams.json` | teams game over, `winnerTeams` and team standings |

They come from three small games played through the real engine with a fake clock. Ids, join
and pairing codes, photo keys and the server origin are replaced by fixed placeholders, so the
files only change when the output does. Running rounds contain no answer (the test asserts it).

Regenerate (needs the dev database, `docker compose up -d db`):

```sh
pnpm tvos:fixtures
```

`pnpm test:unit` fails while a committed file no longer has the shape (keys and value types) of
the current output, or when files are missing or left over.
