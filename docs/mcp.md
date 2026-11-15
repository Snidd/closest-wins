# MCP server

The app serves an [MCP](https://modelcontextprotocol.io) endpoint so an AI agent can help create
game content: **locations** (a point on Earth with a clue photo and/or clue text, a name and a fun
fact, in Swedish and/or English) and **playlists** (ordered lists of locations). It covers content
management only; it cannot create or control games.

- **URL:** `<ORIGIN>/mcp`, e.g. `http://localhost:5173/mcp` in dev or `https://game.example.com/mcp`.
- **Transport:** Streamable HTTP, stateless, JSON responses (POST only; GET and DELETE answer 405
  because there is no server-initiated stream and no session).
- **Auth:** `Authorization: Bearer <MCP_TOKEN>` on every request (`MCP_TOKEN` from the
  environment, at least 16 characters; separate from the admin password). Missing or wrong token:
  `401` with `WWW-Authenticate: Bearer`.
- **Origin:** requests from a browser must come from the app's own `ORIGIN` (or the same loopback
  origin in dev); any other `Origin` gets `403`. Clients that send no `Origin` (CLI agents,
  desktop apps) are fine.

Generate a token with e.g. `openssl rand -hex 24` and set it as `MCP_TOKEN` in `.env` (dev) or the
container environment (production).

## Connecting

### Claude Code

```sh
claude mcp add --transport http closest-wins https://game.example.com/mcp \
  --header "Authorization: Bearer $MCP_TOKEN"
```

Add `--scope user` to make it available in every project (the default scope is local to the
current project). Check it with `claude mcp list` or `/mcp` inside Claude Code.

### Generic JSON config

Most MCP clients (Claude Code's `.mcp.json`, Cursor, VS Code, ...) accept a config like this:

```json
{
  "mcpServers": {
    "closest-wins": {
      "type": "http",
      "url": "https://game.example.com/mcp",
      "headers": { "Authorization": "Bearer ${MCP_TOKEN}" }
    }
  }
}
```

(`${MCP_TOKEN}` is expanded from the environment by Claude Code; for other clients paste the token
or use their own secret mechanism. Never commit the token.)

### Quick check from a terminal

```sh
npx @modelcontextprotocol/inspector --cli http://localhost:5173/mcp --transport http \
  --header "Authorization: Bearer $MCP_TOKEN" --method tools/list
```

## Tools

All text fields are flat and bilingual: `nameSv`/`nameEn`, `clueTextSv`/`clueTextEn`,
`factSv`/`factEn`. Every tool returns `structuredContent` (with an output schema) plus the same JSON
as text. Failures come back as tool errors (`isError: true`) with a message saying what was wrong
and what to do: `Invalid input: <field>: <reason>. ...`, `Not found: ...`, `Refused: ...` (in use),
`Photo import failed: ...`.

| Tool | What it does |
|---|---|
| `list_locations` | List / free-text search locations (both languages), paginated (`limit` ≤ 200, `offset`, `nextOffset`). Compact summaries. |
| `get_location` | One location with all texts, photo and usage (playlists, games played). |
| `create_location` | Create a location; optional `photo: {url, attribution, sourceUrl}` is downloaded and attached. |
| `create_locations` | Create up to 25 locations in one call; per-item result (`ok` + location, or `error`). Not all-or-nothing. |
| `update_location` | Change only the fields sent; `null` or `""` clears a text. |
| `delete_location` | Delete a location (removed from playlists). Refused if it was played in a game. |
| `attach_photo_from_url` | Download an image and set it as a location's clue photo (replaces the old one). |
| `remove_photo` | Remove a location's photo (refused if it is the only clue). |
| `list_playlists` | All playlists with timer, location count and missing-translation count; optional name filter. |
| `get_playlist` | A playlist with its locations in play order. |
| `create_playlist` | Create a playlist (default timer 30 s), optionally with its `locationIds` in order. |
| `update_playlist` | Change names and/or default timer. |
| `delete_playlist` | Delete a playlist (locations and game history are kept). |
| `set_playlist_locations` | Replace the complete ordered list of locations (also used to reorder). Atomic. |
| `add_locations_to_playlist` | Insert locations at the end or a 0-based `position`; ones already present are skipped. |
| `remove_locations_from_playlist` | Remove locations from a playlist (they stay in the library). |
| `find_missing_translations` | Texts that exist in only one language (locations and playlist names), each with the field to fill and the text to translate; filter by `language` or `playlistId`, paginated. |

The server's `instructions` (sent on `initialize`) brief the agent on the game: coordinates must be
the precise point, players only see the clue (never put the name in it), both languages should be
written, and how photos are imported.

Validation is shared with the admin UI: tool arguments are converted in
`src/lib/server/mcp/schemas.ts` and parsed with the valibot schemas in
`src/lib/content/schemas.ts`, and all reads/writes go through `src/lib/server/content/`.

## Example prompt

> Using the closest-wins MCP server, build a playlist called "Europas huvudstäder" / "European
> capitals" with 15 locations, 45 seconds per round. For each capital pick a precise, recognisable
> spot (a landmark, square or building, not the city centroid) and write a clue in both Swedish and
> English that hints at the place without naming it or the city. Add a one-sentence fun fact in
> both languages. Where you can find a freely licensed photo on Wikimedia Commons that does not show
> the name, attach it with attribution and the source page. Search first so you reuse locations
> that already exist. Create the new ones with `create_locations`, then `create_playlist` with all
> ids in a good order (mix easy and hard, spread over the map). Finish with
> `find_missing_translations` for the playlist and fix anything it reports.

## Implementation notes

- `src/routes/mcp/+server.ts` → `mcpEndpoint` in `src/lib/server/mcp/index.ts`: Origin check,
  bearer auth, method check, then the SDK's `WebStandardStreamableHTTPServerTransport`
  (stateless, `enableJsonResponse`) with a fresh `McpServer` per request.
- Tools: `src/lib/server/mcp/tools.ts`; output views: `views.ts`; agent briefing: `instructions.ts`.
- Tests: `src/lib/server/mcp/mcp.test.ts` (SDK client → handler, against the dev DB) and
  `schemas.test.ts` (zod tool schemas vs. the shared valibot schemas at every boundary).
