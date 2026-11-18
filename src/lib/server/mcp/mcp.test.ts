/**
 * MCP endpoint integration tests: the official SDK client (Streamable HTTP transport) talks to
 * `mcpEndpoint` through a `fetch` that builds real `Request`s and routes them into the handler,
 * against the dev database. The DB is shared with other agents: every row created here carries
 * a unique tag and is deleted afterwards; nothing asserts on global counts.
 */
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { LATEST_PROTOCOL_VERSION, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MCP_TOKEN, ORIGIN } from '$app/env/private';
import { ContentError, deleteLocation, deletePlaylist, getLocation, getPlaylist, listLocations } from '#lib/server/content/index.ts';
import { client as dbClient, db } from '#lib/server/db/index.ts';
import { game, gameRound } from '#lib/server/db/schema.ts';
import { errorMessage } from './tools.ts';
import { mcpEndpoint } from './index.ts';

const TAG = `zzmcp${randomUUID().slice(0, 8)}`;
const ENDPOINT = 'http://localhost:5173/mcp';
const created = { locations: new Set<string>(), playlists: new Set<string>(), games: new Set<string>() };

const routedFetch = (url: string | URL, init?: RequestInit) => mcpEndpoint(new Request(url, init));

async function connect(): Promise<Client> {
	const client = new Client({ name: 'closest-wins-test', version: '0.0.0' });
	await client.connect(
		new StreamableHTTPClientTransport(new URL(ENDPOINT), {
			fetch: routedFetch,
			requestInit: { headers: { authorization: `Bearer ${MCP_TOKEN}` } }
		})
	);
	return client;
}

/** A raw JSON-RPC POST (for transport-level checks the SDK client would hide). */
function rawPost(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
	return mcpEndpoint(
		new Request(ENDPOINT, {
			method: 'POST',
			headers: {
				authorization: `Bearer ${MCP_TOKEN}`,
				accept: 'application/json, text/event-stream',
				'content-type': 'application/json',
				...headers
			},
			body: JSON.stringify(body)
		})
	);
}
const initBody = (protocolVersion: string) => ({
	jsonrpc: '2.0',
	id: 1,
	method: 'initialize',
	params: { protocolVersion, capabilities: {}, clientInfo: { name: 'raw', version: '0' } }
});

let mcp: Client;

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function call(name: string, args: Record<string, unknown>): Promise<Json> {
	const res = (await mcp.callTool({ name, arguments: args })) as CallToolResult;
	if (res.isError) throw new Error(`${name} failed: ${(res.content[0] as { text: string }).text}`);
	expect(JSON.parse((res.content[0] as { text: string }).text)).toEqual(res.structuredContent);
	return res.structuredContent as Json;
}
async function callError(name: string, args: Record<string, unknown>): Promise<string> {
	const res = (await mcp.callTool({ name, arguments: args })) as CallToolResult;
	expect(res.isError).toBe(true);
	return (res.content[0] as { text: string }).text;
}
const track = (kind: 'locations' | 'playlists', id: string) => {
	created[kind].add(id);
	return id;
};

beforeAll(async () => {
	mcp = await connect();
});

afterAll(async () => {
	await mcp?.close();
	if (created.games.size) await db.delete(game).where(inArray(game.id, [...created.games]));
	for (const id of created.playlists) await deletePlaylist(id).catch(() => {});
	for (const id of created.locations) {
		await deleteLocation(id).catch((e) => {
			if (!(e instanceof ContentError && e.code === 'NOT_FOUND')) throw e;
		});
	}
	await dbClient.end();
});

describe('transport and protocol', () => {
	it('initializes with server info, instructions and the tools capability', () => {
		expect(mcp.getServerVersion()).toMatchObject({ name: 'closest-wins-content', version: '1.0.0' });
		expect(mcp.getServerCapabilities()?.tools).toBeDefined();
		const instructions = mcp.getInstructions() ?? '';
		expect(instructions).toMatch(/precise point/);
		expect(instructions).toMatch(/Players see ONLY the clue/);
		expect(instructions).toMatch(/Swedish/);
	});

	it('negotiates the protocol version', async () => {
		const older = await rawPost(initBody('2025-06-18'));
		expect(older.status).toBe(200);
		expect(older.headers.get('content-type')).toMatch(/application\/json/);
		expect(older.headers.get('mcp-session-id')).toBeNull(); // stateless
		expect((await older.json()).result.protocolVersion).toBe('2025-06-18');

		const unknown = await rawPost(initBody('1999-01-01'));
		expect((await unknown.json()).result.protocolVersion).toBe(LATEST_PROTOCOL_VERSION);

		const badHeader = await rawPost(
			{ jsonrpc: '2.0', id: 2, method: 'tools/list' },
			{ 'mcp-protocol-version': '1999-01-01' }
		);
		expect(badHeader.status).toBe(400);
	});

	it('returns JSON-RPC errors for malformed requests and unknown methods', async () => {
		const parse = await mcpEndpoint(
			new Request(ENDPOINT, {
				method: 'POST',
				headers: {
					authorization: `Bearer ${MCP_TOKEN}`,
					accept: 'application/json, text/event-stream',
					'content-type': 'application/json'
				},
				body: '{not json'
			})
		);
		expect(parse.status).toBe(400);
		expect((await parse.json()).error.code).toBe(-32700);

		const unknown = await rawPost({ jsonrpc: '2.0', id: 3, method: 'games/start' });
		expect((await unknown.json()).error.code).toBe(-32601);

		const notification = await rawPost({ jsonrpc: '2.0', method: 'notifications/initialized' });
		expect(notification.status).toBe(202);
	});

	it('requires the bearer token', async () => {
		const none = await rawPost(initBody(LATEST_PROTOCOL_VERSION), { authorization: '' });
		expect(none.status).toBe(401);
		expect(none.headers.get('www-authenticate')).toMatch(/^Bearer /);

		const wrong = await rawPost(initBody(LATEST_PROTOCOL_VERSION), { authorization: 'Bearer not-the-token' });
		expect(wrong.status).toBe(401);
		expect(wrong.headers.get('www-authenticate')).toMatch(/error="invalid_token"/);

		const viaClient = new Client({ name: 'no-token', version: '0' });
		await expect(
			viaClient.connect(new StreamableHTTPClientTransport(new URL(ENDPOINT), { fetch: routedFetch }))
		).rejects.toThrow();
	});

	it('rejects browser requests from other origins and allows the app origin', async () => {
		const evil = await rawPost(initBody(LATEST_PROTOCOL_VERSION), { origin: 'https://evil.example' });
		expect(evil.status).toBe(403);
		// DNS rebinding: Host (and so request.url) is attacker-controlled; still refused.
		const rebound = await mcpEndpoint(
			new Request('http://evil.example:5173/mcp', {
				method: 'POST',
				headers: { origin: 'http://evil.example:5173', authorization: `Bearer ${MCP_TOKEN}` },
				body: '{}'
			})
		);
		expect(rebound.status).toBe(403);

		expect((await rawPost(initBody(LATEST_PROTOCOL_VERSION), { origin: ORIGIN })).status).toBe(200);
		expect((await rawPost(initBody(LATEST_PROTOCOL_VERSION), { origin: 'http://localhost:5173' })).status).toBe(200);
	});

	it('answers GET and DELETE with 405 (no server stream, no sessions)', async () => {
		for (const method of ['GET', 'DELETE']) {
			const res = await mcpEndpoint(
				new Request(ENDPOINT, {
					method,
					headers: { authorization: `Bearer ${MCP_TOKEN}`, accept: 'text/event-stream' }
				})
			);
			expect(res.status).toBe(405);
			expect(res.headers.get('allow')).toBe('POST');
		}
	});
});

describe('tools', () => {
	it('lists every tool with descriptions, strict schemas and annotations', async () => {
		const { tools } = await mcp.listTools();
		const names = tools.map((t) => t.name).sort();
		expect(names).toEqual(
			[
				'add_locations_to_playlist',
				'attach_photo_from_url',
				'create_location',
				'create_locations',
				'create_playlist',
				'delete_location',
				'delete_playlist',
				'find_missing_translations',
				'get_location',
				'get_playlist',
				'list_locations',
				'list_playlists',
				'remove_locations_from_playlist',
				'remove_photo',
				'set_playlist_locations',
				'update_location',
				'update_playlist'
			].sort()
		);
		for (const t of tools) {
			expect(t.description!.length, t.name).toBeGreaterThan(40);
			expect(t.inputSchema.additionalProperties, t.name).toBe(false);
			expect(t.outputSchema, t.name).toBeDefined();
			expect(typeof t.annotations?.readOnlyHint, t.name).toBe('boolean');
			for (const [field, schema] of Object.entries(t.inputSchema.properties ?? {})) {
				expect((schema as { description?: string }).description, `${t.name}.${field}`).toBeTruthy();
			}
		}
		const create = tools.find((t) => t.name === 'create_location')!;
		expect(create.inputSchema.required).toEqual(expect.arrayContaining(['lat', 'lng']));
		expect(tools.find((t) => t.name === 'delete_location')!.annotations).toMatchObject({
			readOnlyHint: false,
			destructiveHint: true,
			idempotentHint: true
		});
		expect(tools.find((t) => t.name === 'list_locations')!.annotations?.readOnlyHint).toBe(true);
	});

	it('runs a full content flow', async () => {
		// Two locations: one Swedish-only (needs translating), one bilingual.
		const a = await call('create_location', {
			nameSv: `${TAG} Eiffeltornet`,
			clueTextSv: 'Ett järngaller som var tänkt att rivas efter tjugo år.',
			factSv: 'Tornet växer cirka 15 cm på sommaren.',
			lat: 48.85837,
			lng: 2.294481
		});
		const aId = track('locations', a.location.id);
		expect(a.location).toMatchObject({ nameSv: `${TAG} Eiffeltornet`, nameEn: null, photo: null });
		expect(a.location.missingTranslations).toEqual({ name: ['en'], clueText: ['en'], fact: ['en'] });

		const b = await call('create_location', {
			nameSv: `  ${TAG} Kinesiska muren  `,
			nameEn: `${TAG} Great Wall of China`,
			clueTextSv: 'Synlig från rymden? Nej, men lång.',
			clueTextEn: 'Visible from space? No, but long.',
			factSv: '',
			lat: 40.431908,
			lng: 116.570374
		});
		const bId = track('locations', b.location.id);
		expect(b.location.nameSv).toBe(`${TAG} Kinesiska muren`); // trimmed by the shared validation
		expect(b.location.factSv).toBeNull();

		// Playlist with both, then reorder with the full list.
		const p = await call('create_playlist', { nameEn: `${TAG} Wonders`, locationIds: [aId, bId] });
		const pId = track('playlists', p.playlist.id);
		expect(p.playlist).toMatchObject({ defaultTimerSeconds: 30, locationCount: 2 });
		expect(p.playlist.locations.map((l: Json) => l.id)).toEqual([aId, bId]);

		const set = await call('set_playlist_locations', { playlistId: pId, locationIds: [bId, aId] });
		expect(set.playlist.locations.map((l: Json) => [l.position, l.id])).toEqual([
			[0, bId],
			[1, aId]
		]);
		expect((await getPlaylist(pId))!.items.map((i) => i.location.id)).toEqual([bId, aId]);

		// List / search (across both languages) and pagination fields.
		const search = await call('list_locations', { query: `${TAG} muren` });
		expect(search.items.map((l: Json) => l.id)).toEqual([bId]);
		expect(search).toMatchObject({ total: 1, offset: 0, nextOffset: null });
		expect(search.items[0]).toMatchObject({ hasPhoto: false, hasClueText: true, playlistCount: 1 });
		const byEnglish = await call('list_locations', { query: `${TAG} great wall` });
		expect(byEnglish.items.map((l: Json) => l.id)).toEqual([bId]);
		const paged = await call('list_locations', { query: TAG, limit: 1 });
		expect(paged).toMatchObject({ total: 2, limit: 1, nextOffset: 1 });

		const lists = await call('list_playlists', { query: TAG });
		expect(lists.items).toEqual([
			expect.objectContaining({ id: pId, locationCount: 2, missingTranslationCount: 1 })
		]);

		// Missing translations: the Swedish-only location and the English-only playlist name.
		const missing = await call('find_missing_translations', { playlistId: pId });
		expect(missing.locations.items).toEqual([
			{
				id: aId,
				nameSv: `${TAG} Eiffeltornet`,
				nameEn: null,
				toTranslate: [
					{ field: 'nameEn', from: 'nameSv', text: `${TAG} Eiffeltornet` },
					{ field: 'clueTextEn', from: 'clueTextSv', text: 'Ett järngaller som var tänkt att rivas efter tjugo år.' },
					{ field: 'factEn', from: 'factSv', text: 'Tornet växer cirka 15 cm på sommaren.' }
				]
			}
		]);
		expect(missing.playlistNamesToTranslate).toEqual([
			{ id: pId, toTranslate: [{ field: 'nameSv', from: 'nameEn', text: `${TAG} Wonders` }] }
		]);
		const onlySv = await call('find_missing_translations', { playlistId: pId, language: 'sv' });
		expect(onlySv.locations.total).toBe(0);

		// Library-wide finder (paged through every location) also sees it.
		let found = false;
		for (let offset: number | null = 0; offset !== null && !found; ) {
			const page: Json = await call('find_missing_translations', { language: 'en', limit: 100, offset });
			found = page.locations.items.some((l: Json) => l.id === aId);
			expect(page.playlists.some((x: Json) => x.id === pId)).toBe(true);
			offset = page.locations.nextOffset;
		}
		expect(found).toBe(true);

		// Translate: only the sent fields change; null clears.
		const upd = await call('update_location', {
			id: aId,
			nameEn: `${TAG} Eiffel Tower`,
			clueTextEn: 'An iron lattice meant to be torn down after twenty years.',
			factEn: 'The tower grows about 15 cm in summer.',
			factSv: null
		});
		expect(upd.location).toMatchObject({
			nameSv: `${TAG} Eiffeltornet`,
			nameEn: `${TAG} Eiffel Tower`,
			factSv: null,
			lat: 48.85837
		});
		expect(upd.location.missingTranslations).toEqual({ name: [], clueText: [], fact: ['sv'] });
		await call('update_playlist', { id: pId, nameSv: `${TAG} Underverk`, defaultTimerSeconds: 45 });

		const got = await call('get_location', { id: aId });
		expect(got.usage).toEqual({ playlists: 1, games: 0 });
		expect(got.location.clueTextEn).toMatch(/iron lattice/);

		// Convenience add/remove.
		const removed = await call('remove_locations_from_playlist', { playlistId: pId, locationIds: [bId, randomUUID()] });
		expect(removed.removed).toEqual([bId]);
		expect(removed.notInPlaylist).toHaveLength(1);
		expect(removed.playlist.locations.map((l: Json) => l.id)).toEqual([aId]);
		const added = await call('add_locations_to_playlist', { playlistId: pId, locationIds: [bId, aId], position: 0 });
		expect(added).toMatchObject({ added: [bId], alreadyInPlaylist: [aId] });
		expect(added.playlist.locations.map((l: Json) => l.id)).toEqual([bId, aId]);

		// Delete: the location leaves the playlist; then the playlist.
		const del = await call('delete_location', { id: bId });
		expect(del).toEqual({ deleted: true, id: bId, removedFromPlaylists: 1 });
		expect(await getLocation(bId)).toBeNull();
		expect((await call('get_playlist', { id: pId })).playlist.locations.map((l: Json) => [l.position, l.id])).toEqual([
			[0, aId]
		]);
		expect(await call('delete_playlist', { id: pId })).toEqual({ deleted: true, id: pId });
		expect(await getPlaylist(pId)).toBeNull();
	});

	it('creates locations in a batch with per-item results', async () => {
		const res = await call('create_locations', {
			locations: [
				{ nameEn: `${TAG} Uluru`, nameSv: `${TAG} Uluru`, clueTextEn: 'A red monolith.', lat: -25.344428, lng: 131.036882 },
				{ nameEn: `${TAG} Nameless clue`, lat: 0, lng: 0 },
				{ nameSv: `${TAG} Machu Picchu`, clueTextSv: 'Inkastad i molnen.', lat: -13.163141, lng: -72.544963 }
			]
		});
		for (const r of res.results) if (r.ok) track('locations', r.location.id);
		expect(res).toMatchObject({ created: 2, failed: 1 });
		expect(res.results[0]).toMatchObject({ index: 0, ok: true, location: { lat: -25.344428, hasClueText: true } });
		expect(res.results[1]).toMatchObject({ index: 1, ok: false });
		expect(res.results[1].error).toMatch(/Invalid input: A photo or a clue text is required/);
		expect(res.results[2]).toMatchObject({ index: 2, ok: true });
	});

	it('sets, returns and clears a start view', async () => {
		const startView = { lat: 62.5, lng: 16.25, zoom: 4.5 };
		const a = await call('create_location', { nameEn: `${TAG} Start`, clueTextEn: 'clue', lat: 59.3, lng: 18.1, startView });
		const id = track('locations', a.location.id);
		expect(a.location.startView).toEqual(startView);
		expect((await call('get_location', { id })).location.startView).toEqual(startView);

		const b = await call('create_location', { nameEn: `${TAG} No start`, clueTextEn: 'clue', lat: 1, lng: 1, startView: null });
		track('locations', b.location.id);
		expect(b.location.startView).toBeNull();

		const moved = await call('update_location', { id, startView: { lat: 1, lng: 2, zoom: 3 } });
		expect(moved.location.startView).toEqual({ lat: 1, lng: 2, zoom: 3 });
		const renamed = await call('update_location', { id, nameSv: `${TAG} Startvy` });
		expect(renamed.location.startView).toEqual({ lat: 1, lng: 2, zoom: 3 });
		const cleared = await call('update_location', { id, startView: null });
		expect(cleared.location.startView).toBeNull();
		expect((await call('get_location', { id })).location.startView).toBeNull();

		expect(await callError('update_location', { id, startView: { lat: 1, lng: 2, zoom: 11 } })).toMatch(/zoom/);
		expect(await callError('update_location', { id, startView: { lat: 1, lng: 2 } })).toMatch(/zoom/);
	});

	it('reports invalid input naming the field', async () => {
		const long = await callError('create_location', { nameSv: 'x'.repeat(121), clueTextSv: 'c', lat: 1, lng: 1 });
		expect(long).toMatch(/nameSv/);
		const lat = await callError('create_location', { nameSv: 'n', clueTextSv: 'c', lat: 91, lng: 1 });
		expect(lat).toMatch(/lat/);
		const noName = await callError('create_location', { clueTextSv: 'c', lat: 1, lng: 1 });
		expect(noName).toMatch(/^Invalid input: A name in at least one language is required/);
		const unknownField = await callError('create_location', { name: 'x', clueTextSv: 'c', lat: 1, lng: 1 });
		expect(unknownField).toMatch(/name/);
		const timer = await callError('create_playlist', { nameEn: `${TAG} bad`, defaultTimerSeconds: 1 });
		expect(timer).toMatch(/defaultTimerSeconds/);
		const dupes = await callError('create_playlist', { nameEn: `${TAG} dupes`, locationIds: [randomUUID(), randomUUID()].flatMap((x) => [x, x]) });
		expect(dupes).toMatch(/only appear once/);
		const unknownLoc = await callError('create_playlist', { nameEn: `${TAG} unknown`, locationIds: [randomUUID()] });
		expect(unknownLoc).toMatch(/Unknown location/);
		// Neither failed create_playlist left a playlist behind.
		expect((await call('list_playlists', { query: TAG })).items).toEqual([]);

		const l = await call('create_location', { nameEn: `${TAG} Clear`, clueTextEn: 'clue', lat: 1, lng: 1 });
		track('locations', l.location.id);
		const nothing = await callError('update_location', { id: l.location.id });
		expect(nothing).toMatch(/Nothing to update/);
		const noClue = await callError('update_location', { id: l.location.id, clueTextEn: null });
		expect(noClue).toMatch(/photo or a clue text/);
		const noPhoto = await call('remove_photo', { locationId: l.location.id }); // no photo: no-op
		expect(noPhoto.location.photo).toBeNull();
	});

	it('reports unknown ids as not found', async () => {
		expect(await callError('get_location', { id: randomUUID() })).toMatch(/^Not found: Location not found\. .*list_locations/);
		expect(await callError('get_playlist', { id: randomUUID() })).toMatch(/^Not found: Playlist not found/);
		expect(await callError('update_location', { id: randomUUID(), nameEn: 'x' })).toMatch(/^Not found/);
		expect(await callError('delete_playlist', { id: randomUUID() })).toMatch(/^Not found/);
		expect(await callError('set_playlist_locations', { playlistId: randomUUID(), locationIds: [] })).toMatch(/^Not found/);
		expect(await callError('get_location', { id: 'not-a-uuid' })).toMatch(/id/);
		await expect(mcp.callTool({ name: 'start_game', arguments: {} })).resolves.toMatchObject({ isError: true });
	});

	it('refuses to delete a location that was played in a game', async () => {
		const l = await call('create_location', { nameEn: `${TAG} Played`, clueTextEn: 'clue', lat: 10, lng: 10 });
		const id = track('locations', l.location.id);
		const [g] = await db
			.insert(game)
			.values({ joinCode: 'ZZMC', language: 'en', timerSeconds: 30, roundCount: 1, selection: 'first', phase: 'finished' })
			.returning();
		created.games.add(g!.id);
		await db.insert(gameRound).values({ gameId: g!.id, index: 0, locationId: id });

		expect((await call('get_location', { id })).usage).toEqual({ playlists: 0, games: 1 });
		const msg = await callError('delete_location', { id });
		expect(msg).toMatch(/^Refused: .*game/);
		expect(msg).toMatch(/remove_locations_from_playlist/);
		expect(await getLocation(id)).not.toBeNull();
	});

	it('refuses photo imports from private addresses (SSRF guard) without side effects', async () => {
		const l = await call('create_location', { nameEn: `${TAG} Photo`, clueTextEn: 'clue', lat: 20, lng: 20 });
		const id = track('locations', l.location.id);
		const msg = await callError('attach_photo_from_url', {
			locationId: id,
			url: 'http://127.0.0.1:9/cat.jpg',
			attribution: 'Test, CC0'
		});
		expect(msg).toMatch(/^Photo import failed: .*not allowed.* direct, publicly reachable/);
		expect((await getLocation(id))!.photoId).toBeNull();

		const withPhoto = await callError('create_location', {
			nameEn: `${TAG} Photo only`,
			lat: 1,
			lng: 1,
			photo: { url: 'http://192.168.1.1/x.png' }
		});
		expect(withPhoto).toMatch(/^Photo import failed/);
		expect((await listLocations({ query: `${TAG} Photo only`, limit: 5, offset: 0 })).total).toBe(0);

		// Validation happens before any download: an invalid location never fetches the photo.
		const invalid = await callError('create_location', { lat: 1, lng: 1, photo: { url: 'http://127.0.0.1/x.png' } });
		expect(invalid).toMatch(/^Invalid input: A name/);

		expect(await callError('attach_photo_from_url', { locationId: id, url: 'ftp://example.com/x.png' })).toMatch(/url/);
	});
});

describe('error messages', () => {
	it('never echoes unexpected errors', () => {
		const original = console.error;
		console.error = () => {};
		try {
			const msg = errorMessage('get_location', new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2'));
			expect(msg).not.toMatch(/ECONNREFUSED|hunter2|10\.0\.0\.5/);
			expect(msg).toMatch(/Internal error in get_location/);
		} finally {
			console.error = original;
		}
	});
});
