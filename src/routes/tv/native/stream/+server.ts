import type { RequestHandler } from './$types';
import type { TvStateValue } from '#lib/game/types.ts';
import { tvStream } from '#lib/server/game/streams.ts';
import { bearerToken } from '#lib/server/game/tv-register.ts';

/** Same as Kit's live queries: a comment after 30 s without data keeps proxies from closing it. */
const KEEP_ALIVE_MS = 30_000;
const encoder = new TextEncoder();

/**
 * The native TV app's stream (Apple TV): the one hand-written event stream in the app, for a
 * client that cannot run Kit's remote-function client. It sends exactly what `tvState()` sends
 * (`tvStream`), as plain JSON, so the answer is withheld until the reveal just like on the web.
 *
 * `GET /tv/native/stream`, `Authorization: Bearer <token>` (from `/tv/native/register`).
 * `text/event-stream`: one `data: <TvStateValue JSON>` event per change (the first at once),
 * `: keep-alive` comments when idle. After `{"role":"tv","status":"unregistered"}` (missing,
 * bad or deleted token) the stream ends: register, then reconnect.
 *
 * While open, the paired game's host sees the TV as connected. Pulled like Kit's live queries:
 * the next value is computed when the client has read the previous one.
 */
export const GET: RequestHandler = ({ request }) => {
	const cancel = new AbortController();
	const generator = tvStream(bearerToken(request), AbortSignal.any([request.signal, cancel.signal]));

	let open = true;
	let pulling = false;
	let last: string | undefined;
	let keepAlive: ReturnType<typeof setTimeout> | undefined;
	let controller!: ReadableStreamDefaultController<Uint8Array>;

	function scheduleKeepAlive() {
		clearTimeout(keepAlive);
		keepAlive = setTimeout(() => {
			if (!open) return;
			if ((controller.desiredSize ?? 0) > 0) controller.enqueue(encoder.encode(': keep-alive\n\n'));
			scheduleKeepAlive();
		}, KEEP_ALIVE_MS);
	}

	function send(value: TvStateValue): boolean {
		const json = JSON.stringify(value);
		if (json === last) return false;
		last = json;
		controller.enqueue(encoder.encode(`data: ${json}\n\n`));
		scheduleKeepAlive();
		return true;
	}

	/** Ends the stream once. The abort wakes a generator idling between changes, whose `finally`
	 *  then leaves presence and clears its timers (`return()` alone cannot interrupt it). */
	function teardown(cancelled: boolean) {
		if (!open) return;
		open = false;
		clearTimeout(keepAlive);
		cancel.abort();
		if (!cancelled) controller.close();
		void generator.return(undefined).catch(() => {});
	}

	request.signal.addEventListener('abort', () => teardown(true), { once: true });

	const body = new ReadableStream<Uint8Array>({
		start(c) {
			controller = c;
			scheduleKeepAlive();
		},
		async pull() {
			if (!open || pulling) return;
			pulling = true;
			try {
				while (open) {
					const { value, done } = await generator.next();
					if (!open) return;
					if (done) return teardown(false);
					if (send(value)) return;
				}
			} catch (e) {
				if (!open) return;
				console.error('[tv/native/stream]', e);
				teardown(false);
			} finally {
				pulling = false;
			}
		},
		cancel() {
			teardown(true);
		}
	});

	return new Response(body, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-store',
			'x-accel-buffering': 'no'
		}
	});
};
