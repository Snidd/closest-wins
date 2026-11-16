import Foundation

/// How a round changed a player's place (`movementFor` in `src/routes/tv/tv.svelte.ts`).
public struct Movement: Sendable, Equatable {
	/// Positive: moved up this many places since before the round.
	public let delta: Int
	/// Won the round just revealed.
	public let wonRound: Bool
}

/// Rank movement caused by the round in `result`: the standings before it are the current ones
/// minus this round's win, ranked the same way (rounds won, shared ranks).
public func movement(standings: [StandingRow], result: RoundResult) -> [String: Movement] {
	let winners = Set(result.winnerPlayerIds)
	let before = standings.map { (id: $0.playerId, won: $0.roundsWon - (winners.contains($0.playerId) ? 1 : 0)) }
	var out: [String: Movement] = [:]
	for (row, b) in zip(standings, before) {
		let previousRank = 1 + before.filter { $0.won > b.won }.count
		out[row.playerId] = Movement(delta: previousRank - row.rank, wonRound: winners.contains(row.playerId))
	}
	return out
}
