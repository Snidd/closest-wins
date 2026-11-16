# Apple TV app: handover for the Mac

The big screen is the web page `/tv`. An Apple TV cannot open it (tvOS has no browser and no web
view), so we are building a native tvOS app that shows the same screens. The goal: start the big
screen with nothing but the Apple TV remote.

**Status (2026-11-16):** the server side is built and tested on Linux. The Swift app is not
started. Read `CLAUDE.md` and `INTEND.md` first.

Decisions already made: native SwiftUI app; free Apple ID (reinstall every 7 days); the server
runs on the home LAN over plain HTTP. Rejected: streaming the web page as video from the server
(no Swift, but seconds of lag and heavy server load).

## 1. Before you start on the Mac

- The server work must be **committed and pushed** from the Linux machine first; at the time of
  writing it was uncommitted.
- The Mac only has to build the app. The game server can keep running on the Linux machine
  (`pnpm dev:lan`), as long as the Mac, the Apple TV and the phones are on the same network.
- To run the server on the Mac as well: Node, pnpm, Docker; create `.env` from `.env.example`
  (it is not in git); `docker compose up -d db && pnpm db:migrate && pnpm seed`; the map file
  `data/map/world.pmtiles` is not in git either (`scripts/fetch-map.sh`). The Apple TV app does
  not need the map file, the phones do.
- Tools: Xcode with the tvOS platform installed (Xcode > Settings > Components), and
  `brew install xcodegen`.

## 2. What the server offers the app (the contract)

**`POST /tv/native/register`**

- `Content-Type: application/json` is **required** (body `{}` or empty). Without it the server
  answers 403 (SvelteKit's CSRF check). URLSession sends no content type for an empty POST, so
  set it by hand.
- `Authorization: Bearer <token>` is optional.
- `200 {"tvId": "<uuid>", "token": "<string>"}` for a new screen: store the token.
- `200 {"tvId": "<same uuid>", "token": null}` when the sent token is valid: keep the stored one.
- `429 {"message": "..."}` after 30 new screens in 10 minutes from one address.

**`GET /tv/native/stream`**

- `Authorization: Bearer <token>`. Response is `text/event-stream`.
- Each event is `data: <TvStateValue as JSON>\n\n`: the first at once, then one per change.
  Lines starting with `:` are keep-alive comments (sent after 30 s of silence); ignore them.
- A missing or unknown token gets one event `{"role":"tv","status":"unregistered"}` and the
  stream ends: register, then reconnect.
- On a server error the stream just closes: reconnect with backoff (the web TV uses 2 s to 30 s).
- The host sees the TV as connected while the stream is open.
- `TvStateValue` is defined in `src/lib/game/types.ts`: `unregistered`, `pairing` (code and
  expiry), or `paired` with phase `lobby`, `round`, `reveal`, `standings` or `finished`. All
  times are epoch milliseconds on the server clock; every snapshot has `serverNow`.

**Finding the server (Bonjour)**, when the server runs with `MDNS_ADVERTISE=1`
(`pnpm dev:lan` turns it on):

- Service type `_closestwins._tcp`, instance name `Closest Wins (<hostname>)`.
- TXT record: `v=1` always; `origin=<server URL>` unless the server is on a loopback address.
- App rule: use `origin` when present, otherwise the resolved host and port.

**Generated files in `tvos/`** (regenerate on the server side, never edit by hand):

- `tvos/ClosestWins/Resources/shared.json` (`pnpm tvos:export`): strings in Swedish and
  English, player colours with their text colour, reveal timings, map and pairing constants,
  photo sizes.
  - A plain message is a string. A message with parameters is
    `{ "params": [...], "template": "{n} of {total} locked in" }`, with an optional `cases` list
    for plurals (first matching case wins, otherwise `template`).
  - `common.km` is `{ "format": "distance" }`; `distanceFormat` gives the rule and sample
    outputs to test against.
- `tvos/Fixtures/*.json` (`pnpm tvos:fixtures`, needs the database): 13 real TV snapshots, one
  or more per state. See `tvos/Fixtures/README.md`.
- Unit tests on the server side fail when either is out of date.

## 3. Things that will bite

- **Content type on register**, as above.
- **Plain HTTP:** the app needs an App Transport Security exception in Info.plist
  (`NSAllowsArbitraryLoads`, or `NSAllowsLocalNetworking`), or every request fails.
- **Local network permission:** Bonjour browsing needs `NSBonjourServices`
  (`_closestwins._tcp`) and `NSLocalNetworkUsageDescription` in Info.plist. The first launch
  shows a permission prompt; if it is denied, discovery finds nothing.
- **Distance rounding:** the web rounds half away from zero (3.25 → "3,3 km"); Swift's default
  number formatter rounds half to even. Test against the samples in `shared.json`.
- **Photo URLs are relative**: prefix them with the server address. Photos are WebP.
- **The answer is not in a running round.** Place name, fact and photo credit only arrive with
  the reveal. Do not look for them earlier, and show the photo credit from the reveal on.
- **Clock:** countdowns and reveal stages must use the server clock: offset = `serverNow` minus
  local time at receipt (see `src/lib/game/clock.ts`).
- **Reveal camera numbers are not in `shared.json`.** They are inline in
  `src/lib/map/reveal.ts` (pads 1.5° and 20°, rank ≤ 3, 3× the winner's distance, minimum
  600 km): copy them, or refactor `reveal.ts` to export them and add them to the export.
- **Screensaver:** set `UIApplication.shared.isIdleTimerDisabled = true`, or the Apple TV
  starts its screensaver mid-game.
- **Map:** the web uses MapLibre with our own tiles. The plan assumes MapLibre has no tvOS
  build (check before starting) and uses Apple's MapKit instead, so the map style differs from
  the web and its tiles come from Apple over the internet.
- **Not tested on the server side:** the 30-second keep-alive end to end; discovery from a real
  Apple device (only checked with `avahi-browse` on Linux); Docker with host networking.
- **mDNS on Linux:** the server advertises under its own host name
  `closestwins-<hostname>.local`. An earlier version announced the machine's own name and made
  avahi rename the machine; do not change that back.

## 4. What is left to do

### 4a. The app (`tvos/`)

Describe the project in `tvos/project.yml` for XcodeGen, so no hand-written `.xcodeproj` is
committed (add the generated one to `.gitignore`). Target tvOS 17 (SwiftUI `Map` API).

```
tvos/project.yml
tvos/ClosestWins/App.swift              entry, idle timer off
tvos/ClosestWins/Net/Discovery.swift    NWBrowser for _closestwins._tcp, reads the TXT origin
tvos/ClosestWins/Net/TvClient.swift     register, event stream, reconnect with backoff
tvos/ClosestWins/Model/Snapshot.swift   Codable mirror of TvStateValue
tvos/ClosestWins/Model/Clock.swift      server clock offset
tvos/ClosestWins/Model/Shared.swift     loads shared.json: strings, colours, timings
tvos/ClosestWins/Screens/               Setup, Pairing, Lobby, Round, Reveal, Standings, Finished
tvos/ClosestWins/Views/                 TimerRing, PlayersBar, QrCode (CoreImage), Avatar, Confetti
tvos/ClosestWinsTests/                  decode every file in tvos/Fixtures; distance samples
```

Suggested order:

1. Project file, `Snapshot.swift`, and the test that decodes all 13 fixtures. This proves the
   model before any screen exists.
2. `TvClient` (register, stream, reconnect) and the Pairing screen, against a running server.
   Store the token in `UserDefaults`.
3. Setup screen: Bonjour discovery, with typing the address once as the fallback; remember it.
4. Lobby (join QR from `game.joinUrl`, players), Round (clue photo or text, timer, lock-ins),
   Standings, Finished (winner, next pairing code).
5. Reveal with MapKit: pins in player colours, great-circle lines (`MKGeodesicPolyline`),
   camera move, timed by the stages in `shared.json` from the snapshot's timestamps.

Each screen mirrors a web component in `src/routes/tv/` (`PairingScreen.svelte`,
`LobbyScreen.svelte`, `RoundScreen.svelte`, `RevealScreen.svelte`, `StandingsScreen.svelte`,
`FinishedScreen.svelte`); read it for layout and which strings it uses. Language: the game's
(`game.language`) once paired, the device's before that. Left out of the first version: the
rotating globe backdrop and the split-flap code animation.

### 4b. Docs, when the app works

- README section "Apple TV" (shortened from section 5 below).
- Add `tvos/` to the layout list in `CLAUDE.md`.
- Delete this file.

## 5. Installing on the Apple TV (free Apple ID)

Written from memory of Xcode's flow, not checked against the current Xcode: menu names may have
moved.

One-time setup:

1. Xcode > Settings > Accounts: add your Apple ID. It gives you a "Personal Team".
2. Put the Mac and the Apple TV on the same network.
3. On the Apple TV: Settings > Remotes and Devices > Remote App and Devices, and leave that
   screen open.
4. In Xcode: Window > Devices and Simulators. The Apple TV appears under "Discovered". Select
   it, click Pair, and type the code the TV shows.
5. On the Apple TV: Settings > Privacy & Security > Developer Mode, turn it on and restart
   (the setting appears once the TV has been paired with Xcode).

Each install:

1. `cd tvos && xcodegen && open ClosestWins.xcodeproj`
2. Target > Signing & Capabilities: "Automatically manage signing", Team = your Personal Team,
   and a bundle identifier that is unique to you (for example `com.<yourname>.closestwins`).
3. Pick the Apple TV as the run destination (next to the scheme name) and press Run.
4. If the app refuses to open as "untrusted developer": on the Apple TV, Settings > General >
   Device Management, and trust your developer certificate.
5. Allow the local network prompt on first launch.

Limits of a free Apple ID:

- The app stops opening after **7 days**. Run it from Xcode again; the stored server address
  and TV token survive a reinstall over the top.
- A small number of sideloaded apps per device and of new bundle identifiers per week, so keep
  one bundle identifier.
- A paid membership (99 USD a year) removes the 7-day limit and allows TestFlight.

## 6. Testing the whole thing

1. Server: `pnpm dev:lan` (prints the LAN address; Bonjour is on).
2. Simulator first: run the app in the Apple TV simulator; it should find the server and show a
   pairing code.
3. Open `/host` on a phone, create a game, type the code. The app should show the lobby.
4. Join from two phones and play a full game. Check: the countdown matches the phones, the
   reveal starts together with the phones, standings and winner appear, and a new pairing code
   shows after the game.
5. Stop and start the server mid-game: the app should reconnect by itself.
6. Repeat on the real Apple TV, using only the remote.

Useful without the app:

```sh
curl -X POST -H 'Content-Type: application/json' http://<server>/tv/native/register
curl -N -H 'Authorization: Bearer <token>' http://<server>/tv/native/stream
```
