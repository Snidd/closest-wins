/** Player phone strings. Owned by the player-surface agent; extend freely (keep sv/en in sync). */
import { defineDict } from './dict.ts';

export const player = defineDict({
	en: {
		lockIn: 'Lock in',
		showClue: 'Show clue',
		hideClue: 'Hide clue'
	},
	sv: {
		lockIn: 'Lås gissning',
		showClue: 'Visa ledtråd',
		hideClue: 'Dölj ledtråd'
	}
});
