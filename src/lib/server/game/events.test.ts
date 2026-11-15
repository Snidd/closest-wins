import { describe, expect, it } from 'vitest';
import { gameChanges, notifyGame, subscriberCount } from './events.ts';
import { connectedPlayerIds, enterPresence, isPresent } from './presence.ts';

describe('gameChanges', () => {
	it('yields immediately, then once per (coalesced) change, and unsubscribes on return', async () => {
		const it = gameChanges('g1');
		expect((await it.next()).done).toBe(false);
		expect(subscriberCount('g1')).toBe(1);

		const pending = it.next();
		notifyGame('g1');
		notifyGame('g1');
		expect((await pending).done).toBe(false);

		await it.return(undefined);
		expect(subscriberCount('g1')).toBe(0);
	});

	it('stops when the signal aborts', async () => {
		const ac = new AbortController();
		const it = gameChanges('g2', ac.signal);
		await it.next();
		const pending = it.next();
		ac.abort();
		expect((await pending).done).toBe(true);
		expect(subscriberCount('g2')).toBe(0);
	});
});

describe('presence', () => {
	it('counts streams per client and notifies on connect/disconnect', async () => {
		const it = gameChanges('g3');
		await it.next();

		const leaveA = enterPresence('g3', 'player:a');
		const leaveA2 = enterPresence('g3', 'player:a');
		const changed = it.next();
		expect((await changed).done).toBe(false);
		expect(isPresent('g3', 'player:a')).toBe(true);
		expect([...connectedPlayerIds('g3')]).toEqual(['a']);

		leaveA();
		leaveA(); // idempotent
		expect(isPresent('g3', 'player:a')).toBe(true);
		leaveA2();
		expect(isPresent('g3', 'player:a')).toBe(false);
		expect(connectedPlayerIds('g3').size).toBe(0);
		await it.return(undefined);
	});
});
