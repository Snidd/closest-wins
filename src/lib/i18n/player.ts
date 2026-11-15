/** Player phone strings. Owned by the player-surface agent; extend freely (keep sv/en in sync). */
import { defineDict } from './dict.ts';
import { formatDistance } from './format.ts';

const enOrdinal = (n: number) => {
	const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
	return `${n}${s}`;
};
/** 1:a, 2:a, 3:e … 11:e, 12:e … 21:a, 22:a. */
const svOrdinal = (n: number) => {
	const last = n % 10;
	const lastTwo = n % 100;
	return `${n}:${(last === 1 || last === 2) && lastTwo !== 11 && lastTwo !== 12 ? 'a' : 'e'}`;
};

const enList = (names: string[]) =>
	names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
const svList = (names: string[]) =>
	names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} och ${names.at(-1)}`;

export const player = defineDict({
	en: {
		// Generic
		distance: (km: number) => formatDistance(km, 'en-GB'),
		ordinal: (n: number) => enOrdinal(n),
		list: (names: string[]) => enList(names),
		gameCode: (code: string) => `Game ${code}`,
		loadingGame: 'Joining the game…',
		reconnecting: 'Reconnecting…',
		offline: 'Connection lost. Trying again…',
		errorTitle: 'Lost touch with the game',
		errorBody: 'Check your connection. We’ll keep trying.',
		tryAgain: 'Try again',
		backToStart: 'Back to start',
		you: 'You',

		// Gates
		redirecting: 'Taking you to the join page…',
		noGameTitle: 'No game here',
		noGameBody: (code: string) =>
			`There’s no running game with the code ${code}. Check the code on the TV – the game may have ended.`,
		joinAnother: 'Join another game',
		kickedTitle: 'You’ve been removed',
		kickedBody: 'The host removed you from this game. Thanks for playing!',

		// Lobby
		youreIn: 'You’re in!',
		yourColor: 'Your pin colour',
		lookAtTv: 'Look at the TV – the game starts when the host is ready.',
		keepOpen: 'Keep this page open.',
		playersHere: (n: number) => (n === 1 ? '1 player here' : `${n} players here`),
		waitingForPlayers: 'Waiting for more players…',
		lobbyHow1: 'A clue appears on the TV and here',
		lobbyHow2: 'Drag the map until the cross is on the spot',
		lobbyHow3: 'Lock in – closest wins the round',

		// Round
		roundOf: (n: number, total: number) => `Round ${n}/${total}`,
		suddenDeath: 'Sudden death',
		suddenDeathN: (n: number) => `Sudden death ${n}`,
		clue: 'Clue',
		showClue: 'Show clue',
		hideClue: 'Hide clue',
		openPhoto: 'Open photo',
		closePhoto: 'Close photo',
		photoBy: (credit: string) => `Photo: ${credit}`,
		photoHint: 'Pinch to zoom · tap × to close',
		timeLeft: 'Time left',
		lockIn: 'Lock in',
		locking: 'Locking in…',
		moveMapFirst: 'Move the map to aim',
		untouchedHint: 'Drag the map to put the cross on your guess',
		untouchedWarning: 'Move the map, or you won’t have a guess this round',
		lockedTitle: 'Locked in',
		waitingForOthers: 'Waiting for the others…',
		lockedCount: (locked: number, total: number) => `${locked} of ${total} locked in`,
		lockFailed: 'Couldn’t lock in. Check your connection and try again.',
		lockStale: 'Too late – the round just ended.',
		timeUp: 'Time’s up!',
		timeUpCounts: 'Your cross counts as your guess.',
		timeUpNoGuess: 'You didn’t move the map, so no guess this round.',
		timeUpLocked: 'Your guess is in.',
		revealSoon: 'The answer is coming up on the TV.',
		spectating: 'You’re watching this round',
		spectatingLate: 'You joined mid-round. You’ll play from the next round – explore the map meanwhile.',
		spectatingSuddenDeath: (names: string) => `Sudden death between ${names}. You’re watching.`,
		suddenDeathStakes: 'Closest wins the whole game!',
		suddenDeathVs: (names: string) => `You vs ${names}`,

		// Reveal
		eyesOnTv: 'Eyes on the big screen!',
		eyesOnTvBody: 'The answer is being revealed on the TV.',
		youWonRound: 'You won the round!',
		youSharedRound: 'You share the round win!',
		yourDistance: 'Your guess was',
		away: 'away',
		placeOf: (place: string, total: number) => `${place} of ${total}`,
		noGuessRound: 'No guess this round',
		noGuessRoundBody: 'Remember to move the map next time.',
		spectatedRound: 'You watched this round',
		roundWinner: (names: string) => `Closest: ${names}`,
		nobodyGuessed: 'Nobody made a guess this round.',
		theAnswer: 'The answer',
		mapOfGuesses: 'Everyone’s guesses',

		// Standings
		standings: 'Standings',
		afterRound: (n: number) => `After round ${n}`,
		afterSuddenDeath: 'After sudden death',
		rank: 'Place',
		playerCol: 'Player',
		won: 'Wins',
		total: 'Distance',
		roundsWonShort: (n: number) => (n === 1 ? '1 win' : `${n} wins`),
		nextRound: (n: number, total: number) => `Next up: round ${n} of ${total}. Get ready!`,
		nextSuddenDeathIn: 'It’s a tie at the top – you’re in the sudden death round!',
		nextSuddenDeathOut: (names: string) => `Tie at the top – ${names} play sudden death. You’ll watch.`,
		nextFinish: 'That was the last round. Final results next!',
		yourRound: 'Your round',

		// Finished
		gameOver: 'Game over',
		youWon: 'You won!',
		youSharedWin: 'You share the win!',
		winnerIs: (name: string) => `${name} wins!`,
		sharedWin: (names: string) => `${names} share the win!`,
		nobodyWon: 'Nobody won a round',
		nobodyWonBody: 'A tough one! Nobody got a single round.',
		youFinished: (place: string, total: number) => `You finished ${place} of ${total}`,
		endedEarly: 'The host ended the game early.',
		thanksForPlaying: 'Thanks for playing!',
		finalStandings: 'Final standings'
	},
	sv: {
		distance: (km) => formatDistance(km, 'sv-SE'),
		ordinal: (n) => svOrdinal(n),
		list: (names) => svList(names),
		gameCode: (code) => `Spel ${code}`,
		loadingGame: 'Ansluter till spelet…',
		reconnecting: 'Återansluter…',
		offline: 'Anslutningen bröts. Försöker igen…',
		errorTitle: 'Tappade kontakten med spelet',
		errorBody: 'Kolla din uppkoppling. Vi fortsätter försöka.',
		tryAgain: 'Försök igen',
		backToStart: 'Till startsidan',
		you: 'Du',

		redirecting: 'Skickar dig till sidan för att gå med…',
		noGameTitle: 'Inget spel här',
		noGameBody: (code) =>
			`Det finns inget pågående spel med koden ${code}. Kolla koden på tv:n – spelet kan ha tagit slut.`,
		joinAnother: 'Gå med i ett annat spel',
		kickedTitle: 'Du har tagits bort',
		kickedBody: 'Värden har tagit bort dig från spelet. Tack för att du var med!',

		youreIn: 'Du är med!',
		yourColor: 'Din nålfärg',
		lookAtTv: 'Titta på tv:n – spelet börjar när värden är redo.',
		keepOpen: 'Låt sidan vara öppen.',
		playersHere: (n) => (n === 1 ? '1 spelare här' : `${n} spelare här`),
		waitingForPlayers: 'Väntar på fler spelare…',
		lobbyHow1: 'En ledtråd visas på tv:n och här',
		lobbyHow2: 'Dra kartan tills krysset hamnar på platsen',
		lobbyHow3: 'Lås din gissning – närmast vinner rundan',

		roundOf: (n, total) => `Runda ${n}/${total}`,
		suddenDeath: 'Utslagsrunda',
		suddenDeathN: (n) => `Utslagsrunda ${n}`,
		clue: 'Ledtråd',
		showClue: 'Visa ledtråd',
		hideClue: 'Dölj ledtråd',
		openPhoto: 'Öppna bilden',
		closePhoto: 'Stäng bilden',
		photoBy: (credit) => `Foto: ${credit}`,
		photoHint: 'Nyp för att zooma · tryck × för att stänga',
		timeLeft: 'Tid kvar',
		lockIn: 'Lås gissning',
		locking: 'Låser…',
		moveMapFirst: 'Flytta kartan för att sikta',
		untouchedHint: 'Dra kartan så att krysset hamnar på din gissning',
		untouchedWarning: 'Flytta kartan, annars har du ingen gissning den här rundan',
		lockedTitle: 'Gissningen är låst',
		waitingForOthers: 'Väntar på de andra…',
		lockedCount: (locked, total) => `${locked} av ${total} har låst`,
		lockFailed: 'Det gick inte att låsa. Kolla uppkopplingen och försök igen.',
		lockStale: 'För sent – rundan tog precis slut.',
		timeUp: 'Tiden är slut!',
		timeUpCounts: 'Krysset räknas som din gissning.',
		timeUpNoGuess: 'Du flyttade inte kartan, så du har ingen gissning den här rundan.',
		timeUpLocked: 'Din gissning är inskickad.',
		revealSoon: 'Svaret visas strax på tv:n.',
		spectating: 'Du tittar på den här rundan',
		spectatingLate: 'Du gick med mitt i rundan. Du är med från nästa runda – utforska kartan så länge.',
		spectatingSuddenDeath: (names) => `Utslagsrunda mellan ${names}. Du tittar på.`,
		suddenDeathStakes: 'Den som kommer närmast vinner hela spelet!',
		suddenDeathVs: (names) => `Du mot ${names}`,

		eyesOnTv: 'Titta på storskärmen!',
		eyesOnTvBody: 'Svaret avslöjas på tv:n.',
		youWonRound: 'Du vann rundan!',
		youSharedRound: 'Du delar rundvinsten!',
		yourDistance: 'Din gissning var',
		away: 'bort',
		placeOf: (place, total) => `${place} av ${total}`,
		noGuessRound: 'Ingen gissning den här rundan',
		noGuessRoundBody: 'Kom ihåg att flytta kartan nästa gång.',
		spectatedRound: 'Du tittade på den här rundan',
		roundWinner: (names) => `Närmast: ${names}`,
		nobodyGuessed: 'Ingen gissade den här rundan.',
		theAnswer: 'Rätt svar',
		mapOfGuesses: 'Allas gissningar',

		standings: 'Ställning',
		afterRound: (n) => `Efter runda ${n}`,
		afterSuddenDeath: 'Efter utslagsrundan',
		rank: 'Plats',
		playerCol: 'Spelare',
		won: 'Vinster',
		total: 'Avstånd',
		roundsWonShort: (n) => (n === 1 ? '1 vinst' : `${n} vinster`),
		nextRound: (n, total) => `Nästa: runda ${n} av ${total}. Gör dig redo!`,
		nextSuddenDeathIn: 'Delad ledning – du är med i utslagsrundan!',
		nextSuddenDeathOut: (names) => `Delad ledning – ${names} spelar utslagsrunda. Du tittar på.`,
		nextFinish: 'Det var sista rundan. Slutresultatet kommer nu!',
		yourRound: 'Din runda',

		gameOver: 'Spelet är slut',
		youWon: 'Du vann!',
		youSharedWin: 'Du delar vinsten!',
		winnerIs: (name) => `${name} vinner!`,
		sharedWin: (names) => `${names} delar på vinsten!`,
		nobodyWon: 'Ingen vann någon runda',
		nobodyWonBody: 'En svår en! Ingen tog en enda runda.',
		youFinished: (place, total) => `Du kom ${place} av ${total}`,
		endedEarly: 'Värden avslutade spelet i förtid.',
		thanksForPlaying: 'Tack för att du var med!',
		finalStandings: 'Slutställning'
	}
});
