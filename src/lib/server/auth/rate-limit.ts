/**
 * Fixed-window in-memory rate limiter (single process, which is all this app supports).
 * Only failures are counted; a successful login resets the key.
 */
export class RateLimiter {
	#hits = new Map<string, { count: number; resetAt: number }>();

	constructor(
		readonly maxFailures: number,
		readonly windowMs: number
	) {}

	/** Whether another attempt is allowed, and if not, how many seconds until it is. */
	check(key: string, now: number = Date.now()): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
		const entry = this.#hits.get(key);
		if (!entry || entry.resetAt <= now) return { allowed: true };
		if (entry.count < this.maxFailures) return { allowed: true };
		return { allowed: false, retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000) };
	}

	fail(key: string, now: number = Date.now()): void {
		const entry = this.#hits.get(key);
		if (!entry || entry.resetAt <= now) {
			this.#hits.set(key, { count: 1, resetAt: now + this.windowMs });
		} else {
			entry.count++;
		}
		if (this.#hits.size > 10_000) this.#prune(now);
	}

	reset(key: string): void {
		this.#hits.delete(key);
	}

	#prune(now: number) {
		for (const [k, e] of this.#hits) if (e.resetAt <= now) this.#hits.delete(k);
	}
}

/** 10 failed admin logins per client address per 15 minutes. */
export const loginLimiter = new RateLimiter(10, 15 * 60 * 1000);

/**
 * Join attempts per client address per minute. Generous on purpose: behind NAT a whole room of
 * phones can share one address (and behind a reverse proxy, without ADDRESS_HEADER, every
 * client has the proxy's address). This only stops scripted floods.
 */
export const joinLimiter = new RateLimiter(120, 60 * 1000);

/** New TV registrations (each creates a row) per client address per 10 minutes. */
export const tvRegisterLimiter = new RateLimiter(30, 10 * 60 * 1000);
