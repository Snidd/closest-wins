# Closest Wins / Närmast vinner — notes for agents

Read `INTEND.md` (product + rules) and the approved plan before changing behaviour.

## Two rules that are never negotiable

1. **The answer never leaves the server before reveal.** Target lat/lng, name and fact may only
   appear in a `RoundResult`, which exists only in the `reveal` / `standings` snapshot variants
   (`src/lib/game/types.ts`; the `round` variant has `result?: never`). Do not even select those
   columns while a round is running. This applies to every role, including the host.
   A photo's attribution and source URL count as the answer too (they often name the place):
   a running round sends only the image (`CluePhotoView`); the credit appears from the reveal.
2. **All content reads/writes go through `src/lib/server/content/`** (locations, playlists,
   photos). Admin remote functions and MCP tools both call it; validation lives once in
   `src/lib/content/schemas.ts`. Nothing else touches those tables, with one exception:
   `src/lib/server/game/library.ts` holds the engine's narrow read-only selects (`clues()` never
   reads coordinates, name or fact; `targets()` only runs for ended rounds), because the
   content functions return whole rows including the answer.

## This stack is newer than most docs (SvelteKit 3.2, Svelte 5.57, Vite 8, TS 6)

- No `svelte.config.js`. Kit options (adapter, `experimental.remoteFunctions`, compiler options)
  are passed to `sveltekit({...})` in `vite.config.ts`.
- Env vars are declared in `src/env.ts` with `defineEnvVars` (`@sveltejs/kit/env`) and imported
  from `$app/env/private` / `$app/env/public`. `$env/*` and `$app/environment` are deprecated;
  `dev`/`browser`/`building` come from `$app/env`.
- The lib alias is `#lib` (package.json `imports`), **with file extensions**:
  `import { haversineKm } from '#lib/geo.ts'`. There is no `$lib`.
- Any `server` directory (e.g. `src/lib/server/`) is server-only; a `remote` filename segment
  (`*.remote.ts`) makes a remote module. Remote modules cannot live in a `server` directory and
  cannot export schemas (put schemas in shared modules such as `src/lib/game/types.ts`).
- Remote functions (`query`, `query.live`, `command`, `form` from `$app/server`) + async Svelte
  (`await` in components) are enabled. `query.live` (async generator → streamed to the client,
  `.connected`, `.reconnect()`) is the realtime channel; no hand-written SSE/WebSockets.
  Single exception: `/tv/native/stream` (plain-JSON SSE of `tvStream()`, bearer token) for the
  native Apple TV app, which cannot run Kit's client.
- Queries cannot set cookies or read `event.url`/`params`; only `form`/`command` can set
  cookies. Every remote function authenticates its caller itself (`requireAdmin()`, or a
  player/TV token lookup); never trust `url`/`params` for auth. `redirect` is not allowed in
  `command`s (use `error(401)`).
- Form inputs must use `form.fields.x.as('text' | 'number' | 'hidden' | ...)`; manual `name`s are
  rejected. Booleans in form schemas must be `v.optional(v.boolean(), false)`. Fields starting
  with `_` (e.g. `_password`) are never echoed back.
- Remote forms only accept fields whose name carries the form-id suffix that `fields.x.as(...)`
  generates (`name/<id>`); anything else is rejected. A native radio group inside a remote form
  therefore cannot use a hand-written `name`: keep the choice in local state (custom
  `role="radio"` buttons) and submit it through a hidden input that uses the generated name,
  `name={fields.x.as('hidden', '').name}` (see `src/routes/host/CreateGameForm.svelte`).
- Do not spread a remote field's `value` onto an input (`{...fields.x.as('text')}` includes
  `value`): when the page hydrates it overwrites what the user typed before hydration. Drop
  `value` from the spread and keep the text in a local `bind:value` (see `/join/[code]`).
- `error(status, message)` takes a string message only. `json()`/`text()` are deprecated: use
  `Response.json(...)` / `new Response(...)`. `$app/stores` is gone: use `$app/state`.
- When unsure, read `node_modules/@sveltejs/kit/types/index.d.ts` or
  https://svelte.dev/docs/kit/llms.txt. Do not guess APIs.

## Commands

```sh
docker compose up -d db   # Postgres 18 on host port 5433 (compose project "closest-wins")
pnpm db:migrate           # apply drizzle/ migrations (pnpm db:generate after schema changes; commit them)
pnpm seed                 # idempotent sample content: 16 locations, 2 playlists
pnpm dev                  # http://localhost:5173
pnpm check                # svelte-check, must stay at 0 errors
pnpm test:unit            # vitest, files src/**/*.test.ts (some need the DB running)
pnpm test:e2e             # playwright: builds, runs the adapter-node server on :4173, files **/*.e2e.ts
pnpm build                # adapter-node → build/ ; run with: node --env-file=.env build
pnpm dev:lan              # dev server reachable from phones on the LAN (ORIGIN = LAN address)
```

Admin password for dev is in `.env` (`ADMIN_PASSWORD`). Login page: `/login?next=/host`.

## Layout

```
src/env.ts                    env var declarations (DATABASE_URL, ADMIN_PASSWORD, SESSION_SECRET, MCP_TOKEN, DATA_DIR, ORIGIN)
src/hooks.server.ts           locals.admin, locals.locale, <html lang/data-surface>, engine init
src/app.css                   design tokens (colours, spacing, type, player colours), base + surface styles
src/lib/game/types.ts         SHARED CONTRACT: phases, Player/Host/Tv snapshots, command valibot schemas
src/lib/game/clock.ts         clockOffset / remainingMs for countdowns
src/lib/game/reveal.ts        revealSchedule: when each guess appears in a reveal, and the answer after
src/lib/geo.ts                haversineKm, normalizeLng (client + server)
src/lib/i18n/                 defineDict, useT, localized(); one dictionary per surface:
                              common.ts (shared) · player.ts · host.ts · tv.ts · admin.ts
src/lib/ui/                   Button, TextInput, Card, Countdown, PlayerChip, PLAYER_COLORS
src/lib/map/config.ts         map constants (MAX_ZOOM 10, TILE_MAX_ZOOM 8, WORLD_VIEW, PMTILES_URL)
src/lib/content/schemas.ts    content validation (shared by admin, MCP, client preflight)
src/lib/remote/               game.remote.ts · content.remote.ts · auth.remote.ts
src/lib/server/db/            drizzle schema + client (postgres.js)
src/lib/server/auth/          password check, signed admin cookie, rate limit, player/TV tokens
src/lib/server/game/          engine.ts (state machine) · rules.ts (pure) · views.ts (snapshots)
                              events.ts (per-game change notification) · presence.ts (connected)
src/lib/server/content/       the only access to locations/playlists/photos
src/lib/server/media/         image download (SSRF guard), sharp pipeline, file store
src/lib/server/mcp/           MCP tools over content/
src/lib/server/files/         DATA_DIR paths + Range-capable file responses
src/routes/                   / · /join/[code] · /play/[code] · /host · /host/[gameId] · /tv
                              /admin/... · /login · /mcp · /media/[...key] · /map/[file]
                              /tv/native/register (POST) · /tv/native/stream (GET): Apple TV app
scripts/seed.ts               pnpm seed
drizzle/                      generated SQL migrations (committed)
src/lib/surface.ts            route → <html data-surface> + viewport (server hook and root layout)
e2e/                          playwright tests; e2e/helpers/ is the one shared helper library
                              (remote-function client, db fixtures, simulated players/TV, phones)
tvos/                         Apple TV app (SwiftUI, tvOS 17+), the native twin of /tv:
  project.yml                 XcodeGen input; the .xcodeproj is generated, not committed
  Core/                       Swift package: snapshot model, TvClient, strings, distance format,
                              reveal timing and geometry; `cd tvos/Core && swift test`
  ClosestWins/                the app: AppModel, Screens/ (one per web TV screen), Views/
  ClosestWins/Resources/shared.json, Fixtures/   generated (pnpm tvos:export / tvos:fixtures)
data/                         runtime data (gitignored): media/, map/world.pmtiles
Dockerfile, compose.prod.yaml production image and stack (see README)
compose.lan.yaml              the same image for a home server / Portainer: host network, map download
```

## Conventions

- Bilingual fields are `<field>Sv` / `<field>En` everywhere (DB rows and snapshots); render with
  `localized(obj, 'name', locale)` (falls back to the other language).
- In components: `const t = useT(player)` then `{t().lockIn}`. Add strings to your surface's
  dictionary; `defineDict` makes a missing/extra Swedish key a type error. The root layout
  provides the device locale; the TV calls `provideLocale(() => game.language)` for its subtree.
- Times in snapshots are epoch ms on the server clock; every snapshot has `serverNow`.
- Pages are mobile first and use the tokens in `src/app.css`; no UI framework.
  `<html data-surface>` is `tv` (type scales with the viewport), `play` (page zoom, scroll and
  overscroll locked for the map; add class `scrollable` to panels that must scroll), `host`,
  `admin` or `default`.
- Player pin colours: `PLAYER_COLORS` (40, most distinct first) mirrored as `--player-N` in
  `app.css`; a unit test keeps them in sync.
- Files that are stubs throw `Not implemented` (server modules) or `error(501)` (remote
  functions). Their exported names and signatures are the contract; keep them when filling bodies.

## Testing notes

- e2e runs against the production server (`node build`), never `vite preview`: preview gzips
  responses, which buffers the live-query event streams. Production refuses remote calls without
  a same-origin `Origin` header; `e2e/helpers/remote.ts` sends one and throws on every error.
- Remote ids are `<djb2 of the module path>/<export>` in dev and in builds (`remoteId()`).
- Wait for `html[data-hydrated="true"]` before interacting with a page (set by the root layout),
  not for network idle.
- `e2e/full-game.e2e.ts` runs as its own project after the rest (its sudden death picks any
  library location and it restarts a private server); iterate with
  `pnpm test:e2e e2e/full-game.e2e.ts --no-deps`.
