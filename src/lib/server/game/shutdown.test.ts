// Own file: endAllStreams() is permanent for the module instance.
import { describe, expect, it } from 'vitest';
import { endAllStreams, isShuttingDown, watchChannels } from './events.ts';

describe('endAllStreams', () => {
	it('ends idle and future streams so the HTTP server can close', async () => {
		const idle = watchChannels(() => ['g1']);
		expect((await idle.next()).done).toBe(false); // first value: immediately
		const pending = idle.next(); // now waiting for a change
		expect(isShuttingDown()).toBe(false);
		endAllStreams();
		expect((await pending).done).toBe(true);
		expect(isShuttingDown()).toBe(true);
		// A stream opened during shutdown ends at once.
		expect((await watchChannels(() => ['g2']).next()).done).toBe(true);
	});
});
