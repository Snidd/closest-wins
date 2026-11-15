/** Host controller strings. Owned by the host-surface agent; extend freely (keep sv/en in sync). */
import { defineDict } from './dict.ts';

export const host = defineDict({
	en: {
		createGame: 'Create game',
		startRound: 'Start round'
	},
	sv: {
		createGame: 'Skapa spel',
		startRound: 'Starta runda'
	}
});
