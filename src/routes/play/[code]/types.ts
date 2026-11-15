import type { PlayerSnapshot } from '#lib/game/types.ts';

/** The player snapshot narrowed to one phase. */
export type Snap<P extends PlayerSnapshot['phase']> = Extract<PlayerSnapshot, { phase: P }>;
