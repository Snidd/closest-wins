# Closest Wins · Närmast vinner

A party game for one room. Everybody sees a clue (a photo and/or a short text) on the big
screen and on their own phone, pans a world map on the phone until the cross in the middle is
where they think the place is, and locks in. Whoever is closest wins the round. The most rounds
won wins the game; a tie at the top goes to sudden death.

- **Players** use their phones. No accounts: they scan a QR code and type a nickname.
- **The host** runs the game from their own phone (start, reveal, next round, remove a player).
  The host does not play.
- **The big screen** (`/tv`, a TV or a laptop on HDMI) shows the join code, the clue and the
  countdown, then the reveal: everyone's pins, a flight to the answer, distances and the winner.
- **Admin** pages manage locations and playlists. An **MCP server** lets an AI agent help write
  content.
- Swedish and English throughout. Phones follow their own language; the big screen uses the
  language the host picked for the game.

`INTEND.md` describes what the game is meant to be and why; this file is how to run it.

## Quick start (development)

Needs Node 26, pnpm 12 and Docker (for Postgres).

```sh
pnpm install
cp .env.example .env              # dev defaults; change ADMIN_PASSWORD if you like
docker compose up -d db           # Postgres 18 on localhost:5433
pnpm db:migrate                   # create the tables
pnpm seed                         # 16 sample locations, 2 playlists (idempotent)
pnpm map                          # download the world map (~120 MB, once; see below)
pnpm dev                          # http://localhost:5173
```

Open <http://localhost:5173/host>, log in with `ADMIN_PASSWORD` from `.env`, and you are
ready to host. `/tv` in another window is the big screen; phones (or a phone-sized browser
window) join at <http://localhost:5173>.

### The map

The map is self-hosted: one [PMTiles](https://docs.protomaps.com/pmtiles/) file at
`DATA_DIR/map/world.pmtiles` (default `./data/map/`). `pnpm map` (= `scripts/fetch-map.sh`)
downloads the `pmtiles` tool, extracts the world up to zoom 8 from the newest
[Protomaps](https://protomaps.com) build over HTTP range requests, keeps only what our
labels-free style draws (land, water, landcover, country borders, plus Natural Earth rivers) and
writes a ~120 MB file. It needs `curl` and an internet connection, and takes a few minutes.
`FORCE=1 pnpm map` rebuilds it; `MAXZOOM=6 pnpm map` makes a smaller, coarser file.

## Hosting a game night

1. **Before guests arrive:** on your phone open `<your address>/host` and log in with the admin
   password.
2. **Create the game:** pick a playlist, the number of rounds (first N or N random), whether to
   shuffle, seconds per round and the big screen's language. Tap *Create game*.
3. **Pair the big screen:** open `<your address>/tv` on the TV or laptop. It shows a six-digit
   code; type it on your phone. The TV now shows the join QR code and the four-letter game code.
4. **Players join:** they scan the QR code (or open the address and type the code) and pick a
   nickname. Each gets a pin colour. You can remove anyone from the player list.
5. **Play:** tap *Start game*. Everyone has until the timer runs out; the round ends early once
   everybody who is connected has locked in, or when you hold *End round now*. A player who never
   moves the map has no guess that round; one who moved it but did not lock in is counted where
   the cross was when time ran out.
6. **Reveal:** the TV shows all pins, flies to the answer and crowns the closest player; phones
   show each player's own distance once the TV shows the answer. Tap *Show standings*, then start
   the next round.
7. **The end:** after the last round the standings decide. Tied leaders play sudden-death rounds
   (a random location not used yet) until one is closest. The TV then shows the winner and a new
   pairing code, so the same screen can be paired with your next game.

People can join between rounds (they start at 0), a phone that reloads or loses its connection
comes back as the same player, and if the server restarts mid-round the game carries on where it
was.

### Playing over your home network (dev server)

Phones need to reach the server, and the QR code must contain an address they can open:

```sh
pnpm dev:lan                       # finds your LAN address, e.g. http://192.168.1.20:5173
LAN_IP=192.168.1.20 pnpm dev:lan   # or choose it yourself
```

`dev:lan` runs the dev server on all interfaces with `ORIGIN=http://<lan-ip>:5173`, which is what
the join URL and the QR code are built from. (Doing it by hand: `ORIGIN=http://<lan-ip>:5173
pnpm dev --host`.) Phones must be on the same Wi-Fi and the port must be open in your firewall.
For a real party the production build is smoother: see *Deployment*.

### Apple TV

An Apple TV has no browser, so the big screen there is a small native app in `tvos/` that shows
the same screens as `/tv`. It finds the server over Bonjour (the server must run with
`MDNS_ADVERTISE=1`; `pnpm dev:lan` turns it on), or you type the address once with the remote.
The reveal map comes from Apple (MapKit), so it looks different from the web one and the Apple TV
needs the internet.

The app is currently always in Swedish, regardless of the game's language and the Apple TV's
language. The flag is `AppModel.forcedLanguage` in `tvos/ClosestWins/AppModel.swift`; setting it
to `nil` makes the app follow the game language like `/tv`.

Building it needs a Mac with Xcode (with the tvOS platform) and `brew install xcodegen`:

```sh
cd tvos && xcodegen && open ClosestWins.xcodeproj
```

- **Simulator:** pick an Apple TV simulator and press Run.
- **A real Apple TV** (a free Apple ID is enough):
  1. Xcode > Settings > Accounts: add your Apple ID.
  2. On the Apple TV, open Settings > Remotes and Devices > Remote App and Devices; in Xcode,
     Window > Devices and Simulators, select the Apple TV and pair it with the code it shows.
     Then turn on Settings > Privacy & Security > Developer Mode on the Apple TV.
  3. Create `tvos/Local.xcconfig` with your team and a bundle identifier of your own (see
     `tvos/Config.xcconfig`), and run `xcodegen` again.
  4. Pick the Apple TV as the run destination and press Run. Allow the local network prompt on
     first launch.
- With a free Apple ID the app stops opening after 7 days: run it from Xcode again. The server
  address and the screen's registration survive.

`cd tvos/Core && swift test` runs the app's logic tests on the Mac. `pnpm tvos:export` and
`pnpm tvos:fixtures` regenerate the files the app shares with the web (`shared.json`, the
snapshot fixtures) after changing strings or snapshots.

## Content and admin

`/admin` (same password) manages:

- **Locations**: a point (paste coordinates or a Google Maps link, or click on the map), a name,
  a clue photo and/or clue text, and an optional fact shown at the reveal, each in Swedish and/or
  English (the other language falls back). Photos are uploaded or imported from a URL; the server
  strips EXIF/GPS, stores WebP sizes under `DATA_DIR/media` and records the source and credit.
  Missing translations get a badge.
- **Playlists**: an ordered list of locations and a default round timer.
- **Games**: the history of finished games with their rounds and standings.

### MCP

`/mcp` is an MCP server (Streamable HTTP, bearer `MCP_TOKEN`) with tools to search, create,
update and delete locations and playlists, add translations and attach photos by URL. It cannot
run games. Setup for Claude Code and other clients: [docs/mcp.md](docs/mcp.md).

## Testing

```sh
pnpm check          # svelte-check (types), must be clean
pnpm test:unit      # vitest; most suites need the dev database running
pnpm test:e2e       # Playwright: builds the app and runs the production server on :4173
```

The end-to-end suite needs the dev database (seeded) and the map file. It plays real games on
real pages: `e2e/full-game.e2e.ts` runs a host phone, a TV and three phones through a whole game
(tie, sudden death) and a second game with a late joiner, a reload, a kick and a server restart;
it runs last, on its own. Every test creates and removes its own data, so the dev database can be
shared. `E2E_BASE_URL=http://localhost:5173 pnpm test:e2e` runs against a running `pnpm dev`
instead (the restart scenario then skips itself). Headless WebGL uses the system Chromium at
`/usr/bin/chromium` when there is one.

## Deployment (Docker)

The production shape is one Node process (adapter-node) next to Postgres, behind your reverse
proxy for TLS.

```sh
cp .env.production.example .env.production   # fill in ORIGIN, passwords, secrets
docker compose -f compose.prod.yaml --env-file .env.production up -d --build
```

- The app container runs the database migrations on every start, then the server (port 3000,
  published on `APP_PORT`). It runs as a non-root user.
- Two named volumes: `pgdata` (Postgres) and `data` (mounted at `DATA_DIR=/data`: photos and the
  map file). Back up both.
- **The map file:** download it straight into the volume with the tools image (needs internet):
  `docker compose -f compose.prod.yaml --env-file .env.production run --rm tools`. Or build it on
  any machine with `pnpm map` and copy it in:
  `docker compose -f compose.prod.yaml --env-file .env.production run --rm --no-deps -v "$PWD/data/map/world.pmtiles:/tmp/world.pmtiles:ro" --entrypoint cp app /tmp/world.pmtiles /data/map/world.pmtiles`.
  It can be replaced while the app runs.
- **Sample content** (optional):
  `docker compose -f compose.prod.yaml --env-file .env.production run --rm app node scripts/seed.ts`.
- `docker compose stop` is quick even mid-game: on SIGTERM the server ends all live streams at
  once and exits; phones, host and TV reconnect by themselves when it is back, and a running
  round keeps its deadline.

### On a home server (one step, Portainer)

`compose.lan.yaml` is the same image arranged for a server on your own network, over plain HTTP:

```sh
cp .env.lan.example .env.lan     # ORIGIN = the server's LAN address, plus the secrets
docker compose -f compose.lan.yaml --env-file .env.lan up -d --build
```

In Portainer: Stacks > Add stack > Repository, compose path `compose.lan.yaml`, and the names
from `.env.lan.example` as environment variables.

- It starts the app, Postgres and a one-off `map` container that downloads the world map into
  the data volume on the first start (a few minutes; phones show "map could not be loaded" until
  it has finished) and then exits. That it shows as "exited" afterwards is normal.
- `SEED_SAMPLE_CONTENT=1` adds the sample locations and playlists on start.
- The app uses the host's network so the Apple TV app finds it over Bonjour. That needs a Linux
  host and UDP 5353 open in its firewall; it listens on `APP_PORT` (3000) directly, and
  Postgres is published on the server's loopback only (`DB_PORT`, 5434).
- `ORIGIN` must be the address the phones open (`http://<server-ip>:3000`): give the server a
  fixed address in your router.
- **With a local DNS name and Nginx Proxy Manager** (e.g. `https://closestwins.example.com`):
  set `ORIGIN` to that `https://` name and `ADDRESS_HEADER=X-Forwarded-For`. The proxy host
  forwards to `http://<server-ip>:3000`, with this under *Advanced > Custom Nginx
  Configuration* (live updates are long-lived event streams, uploads go up to 15 MB):

  ```nginx
  proxy_buffering off;
  proxy_read_timeout 1h;
  client_max_body_size 16m;
  ```

  Leave "Cache Assets" off. The certificate must be one the phones and the Apple TV trust
  (e.g. Let's Encrypt through a DNS challenge); the Apple TV app gets the `https://` address
  over Bonjour, or you type it in once.

### On a public server with HTTPS (Azure VM)

`compose.azure.yaml` is the same image for one VM on the internet, so players do not have to be
on your Wi-Fi: the app, Postgres, the one-off map download and [Caddy](https://caddyserver.com),
which gets and renews a Let's Encrypt certificate by itself.

```sh
az login
scripts/azure/create-vm.sh       # resource group, firewall, fixed address, Ubuntu VM with Docker
```

The script prints the VM's address, an Azure DNS name (`<label>.<region>.cloudapp.azure.com`) and
the commands for the VM itself:

```sh
ssh azureuser@<address>
cd closest-wins
cp .env.azure.example .env.azure   # DOMAIN and the secrets
docker compose -f compose.azure.yaml --env-file .env.azure up -d --build
```

- `DOMAIN` is the Azure DNS name, or your own name with an A record that points at the VM. It
  must resolve before the first start, or Caddy cannot get the certificate.
- Only ports 80 and 443 are open to everyone; SSH only from the address you ran the script from
  (`SSH_SOURCE=<address> scripts/azure/create-vm.sh` again when yours changes).
- The login is open to the internet: use a long `ADMIN_PASSWORD`.
- The Apple TV app cannot discover a server on the internet: type `https://<DOMAIN>` into it once.
- Update with `git pull`, then the same `docker compose ... up -d --build`.
- The database and the photos are Docker volumes on the VM's disk: back up the VM (Azure Backup
  or disk snapshots). `az group delete --name closest-wins` removes everything.

It is not tied to Azure: the compose file works on any Linux VM with Docker and ports 80/443.

### Behind a reverse proxy

- Set `ORIGIN` to the public `https://` URL (cookies are then `Secure`; join links and the QR use
  it; form posts from other origins are refused).
- Set `ADDRESS_HEADER=X-Forwarded-For` (and `XFF_DEPTH` = number of proxies) so the login and
  join rate limits see real client addresses rather than the proxy's.
- Live updates are server-sent event streams on `/_app/remote/…` that stay open for the whole
  game: turn response buffering off and use long read timeouts there. Kit sends a keep-alive
  comment every 30 s.
- Compress HTML/JS/CSS if you like (static assets are also served precompressed), but do not
  compress `/map/` responses: the tiles inside the file are already gzipped and the map reads it
  with `Range` requests.
- Uploads go up to 15 MB: allow request bodies of at least 16 MB (`client_max_body_size 16m` in
  nginx).

nginx, for example:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 16m;
}
location /_app/remote/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 1h;
    client_max_body_size 16m;
}
```

Caddy needs nothing special: `game.example.com { reverse_proxy 127.0.0.1:3000 }` (it streams
`text/event-stream` responses without buffering).

## Configuration

| Variable | Required | Default | What it does |
|---|---|---|---|
| `DATABASE_URL` | yes | – | Postgres connection string |
| `ADMIN_PASSWORD` | yes | – | The one shared password for `/admin` and `/host` |
| `SESSION_SECRET` | yes | – | Signs the admin cookie (≥ 32 characters, `openssl rand -hex 32`) |
| `MCP_TOKEN` | yes | – | Bearer token for `/mcp` (≥ 16 characters) |
| `ORIGIN` | yes in production | `http://localhost:5173` | Public URL: join links, QR code, CSRF check, `Secure` cookies |
| `DATA_DIR` | no | `./data` (`/data` in Docker) | Photos (`media/`) and the map (`map/world.pmtiles`) |
| `BODY_SIZE_LIMIT` | for uploads | `512K` (adapter-node), `16M` in Docker | Largest request body; photo uploads need `16M` |
| `PORT` / `HOST` | no | `3000` / `0.0.0.0` | Where the production server listens |
| `ADDRESS_HEADER`, `XFF_DEPTH` | behind a proxy | – | Real client address for rate limits |
| `PROTOCOL_HEADER`, `HOST_HEADER` | rarely | – | Only if you cannot set `ORIGIN` |
| `SHUTDOWN_TIMEOUT` | no | `30` (`10` in Docker) | Seconds to wait for ordinary requests on shutdown |
| `DEV_PAGES` | no | off | `1` serves the `/dev/*` map playground in a production build (tests) |
| `MDNS_ADVERTISE` | no | off (on in `pnpm dev:lan`) | `1` advertises `_closestwins._tcp` over Bonjour so the Apple TV app finds the server; needs UDP 5353 open in the firewall, and `network_mode: host` in Docker |

## Project layout

```
src/routes/            pages: / (join code), /join/[code], /play/[code] (phone), /host, /host/[id],
                       /tv, /admin/…, /login, /mcp, /media/…, /map/[file], /dev/map (dev only)
src/lib/game/types.ts  the shared contract: phases, snapshots per role, command schemas
src/lib/remote/        remote functions (game, content, auth): the client/server API
src/lib/server/game/   the engine (state machine in Postgres), rules, views, live streams
src/lib/server/content content service: the only access to locations, playlists, photos
src/lib/server/media/  photo download (SSRF guard) and the sharp pipeline
src/lib/server/mcp/    MCP tools
src/lib/map/           MapLibre style, the guessing map, the reveal map
src/lib/i18n/          Swedish/English dictionaries per surface
scripts/               seed, migrate, map download, dev:lan
drizzle/               SQL migrations
e2e/                   Playwright tests and their helpers (e2e/helpers/)
tvos/                  the Apple TV app (SwiftUI); tvos/Core is its logic as a Swift package
INTEND.md              what the game is meant to be; CLAUDE.md: notes for coding agents
```

## Data and attribution

- Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL),
  packaged by [Protomaps](https://protomaps.com); low zooms and rivers from
  [Natural Earth](https://www.naturalearthdata.com) (public domain). The maps show
  "© OpenStreetMap · Protomaps" in a corner.
- Clue photos carry the source and credit entered with them; make sure you may use them.
