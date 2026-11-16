/**
 * The native TV app's contract (Apple TV): `POST /tv/native/register` and
 * `GET /tv/native/stream`, plain HTTP + JSON with a bearer token, no cookies and no `Origin`
 * header. The stream must carry exactly what the web TV gets, so the answer stays on the server
 * until the reveal. Each test removes what it created.
 */
import { expect, test } from '@playwright/test';
import type { HostSnapshot, TvStateValue } from '../src/lib/game/types.ts';
import { Admin } from './helpers/admin.ts';
import { closeDb, db, deleteTvs, loadLocation, SEED } from './helpers/db.ts';
import { GameDriver } from './helpers/driver.ts';
import { makePhoto } from './helpers/photo.ts';
import { NativeTv, SimTv } from './helpers/sim.ts';

test.setTimeout(60_000);

const BASE = () => test.info().project.use.baseURL!;

test.afterAll(async () => {
	await closeDb();
});

const isPhase = (phase: string) => (v: TvStateValue) => v.status === 'paired' && v.phase === phase;

test('register is idempotent with the bearer token; a missing or bad token gets "unregistered" and the stream ends', async () => {
	const tv = new NativeTv(BASE());
	try {
		// Contract for the app: without an Origin header, Kit's CSRF check rejects a POST whose
		// content type is missing or form-like, so register sends `Content-Type: application/json`.
		const bare = await fetch(`${BASE()}/tv/native/register`, { method: 'POST' });
		expect(bare.status).toBe(403);

		const first = await tv.register();
		expect(first.tvId).toMatch(/^[0-9a-f-]{36}$/);
		expect(first.token).toMatch(/^[A-Za-z0-9_-]{40,64}$/);

		const again = await tv.register();
		expect(again).toEqual({ tvId: first.tvId, token: null });
		expect(tv.token).toBe(first.token);

		for (const token of [null, 'not-a-token', 'x'.repeat(43)]) {
			const s = await tv.stream(token);
			await s.ended;
			expect(s.events.map((e) => e.value)).toEqual([{ role: 'tv', status: 'unregistered' }]);
		}
	} finally {
		tv.disconnect();
		await deleteTvs([tv.tvId].filter(Boolean));
	}
});

test('a native TV pairs, follows the game, shows as connected and never receives the answer before the reveal', async () => {
	const admin = await Admin.login(BASE());
	const secrets = {
		name: 'Native TV secret lake',
		nameSv: 'Hemlig sjö för appen',
		fact: 'A fact only the reveal may show.',
		attribution: 'Native Photographer / CC BY 4.0',
		sourceUrl: 'https://example.org/wiki/Native_TV_secret_lake.jpg',
		lat: 46.51234,
		lng: 8.04321
	};
	const photo = await admin.createPhotoLocation({
		image: await makePhoto('landscape'),
		attribution: secrets.attribution,
		nameEn: secrets.name,
		nameSv: secrets.nameSv,
		clueTextEn: 'Mountains around a cold lake',
		factEn: secrets.fact,
		lat: secrets.lat,
		lng: secrets.lng
	});
	await db()`update photo set source_url = ${secrets.sourceUrl} where id = ${photo.photoId}`;

	const g = await GameDriver.create(BASE(), { locations: [photo.locationId, SEED.eiffel] }, admin);
	const tv = new NativeTv(BASE());
	const web = new SimTv(BASE());
	try {
		await tv.register();
		g.trackTv(tv.tvId);
		const stream = await tv.stream();
		expect(stream.response.headers.get('content-type')).toBe('text/event-stream');
		expect(stream.response.headers.get('cache-control')).toBe('no-store');
		expect(stream.response.headers.get('x-accel-buffering')).toBe('no');

		const pairing = (await stream.next((v) => v.status === 'pairing')).value;
		if (pairing.status !== 'pairing') throw new Error('unreachable');
		expect(pairing.pairingCode).toMatch(/^\d{6}$/);
		expect(pairing.codeExpiresAt).toBeGreaterThan(pairing.serverNow);

		await g.pairTv(pairing.pairingCode);
		const lobby = (await stream.next(isPhase('lobby'))).value;
		expect(lobby.status === 'paired' && lobby.game.id).toBe(g.gameId);

		// The open native stream counts as the game's TV being connected.
		const hostLive = admin.stream<HostSnapshot>('game', 'hostState', g.gameId);
		await hostLive.opened;
		await hostLive.next((h) => h.tv.paired && h.tv.connected);

		await g.join('Anna');
		await g.startRound();
		const round = await stream.next(isPhase('round'));
		if (round.value.status !== 'paired' || round.value.phase !== 'round') throw new Error('unreachable');
		expect(round.value.round.clue.photo?.urls.lg).toBeTruthy();
		expect(round.value).not.toHaveProperty('result');
		expect(round.value.round.clue.photo).not.toHaveProperty('attribution');
		// Nothing of the answer anywhere in what was sent so far, not even in another field.
		const location = await loadLocation(photo.locationId);
		const forbidden = [
			secrets.name,
			secrets.nameSv,
			secrets.fact,
			secrets.attribution,
			'Native Photographer',
			secrets.sourceUrl,
			'Native_TV_secret_lake',
			String(location.lat),
			String(location.lng)
		];
		for (const event of stream.events) {
			for (const secret of forbidden) expect(event.raw).not.toContain(secret);
		}

		// Plain JSON carries the same snapshot as the web TV's devalue stream (same token as cookie).
		web.cookies.set('cw_tv', tv.token!);
		await web.connect();
		const webRound = await web.state(isPhase('round'));
		const { serverNow: _a, ...nativeRest } = round.value;
		const { serverNow: _b, ...webRest } = webRound as typeof round.value;
		expect(nativeRest).toEqual(webRest);
		web.disconnect();

		// The answer arrives with the reveal (so the check above can fail).
		await g.guess('Anna', 46, 7, { lock: false });
		await g.endRoundNow();
		const reveal = await stream.next(isPhase('reveal'));
		expect(reveal.raw).toContain(secrets.name);
		expect(reveal.raw).toContain(secrets.attribution);
		expect(reveal.raw).toContain(secrets.sourceUrl);

		// Closing the stream releases the TV's presence (the generator was closed).
		stream.close();
		await hostLive.next((h) => h.tv.paired && !h.tv.connected);
		hostLive.close();
	} finally {
		tv.disconnect();
		web.disconnect();
		await g.cleanup();
	}
});
