/** Big screen strings. Owned by the TV-surface agent; extend freely (keep sv/en in sync). */
import { defineDict } from './dict.ts';

export const tv = defineDict({
	en: {
		pairingTitle: 'Pair this screen',
		scanToJoin: 'Scan to join'
	},
	sv: {
		pairingTitle: 'Para ihop skärmen',
		scanToJoin: 'Skanna för att gå med'
	}
});
