import Foundation

// Team display names (`src/lib/game/teams.ts`). A team without a custom name is "Team 2" /
// "Lag 2" (1-based), in the TV's language.

extension Strings {
	/// The custom name of team `index` (0-based), or the default name.
	public func teamName(_ index: Int, _ name: String?) -> String {
		let custom = name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
		return custom.isEmpty ? common("teamDefault", ["n": .int(index + 1)]) : custom
	}

	/// The display name of team `index` of a game (from `GameInfo.teams`).
	public func teamName(_ index: Int, of game: GameInfo) -> String {
		teamName(index, game.teamName(index))
	}

	/// Display names of several teams of a game, joined for a sentence ("Red & Team 2").
	public func teamNames(_ indexes: [Int], of game: GameInfo) -> String {
		indexes.map { teamName($0, of: game) }.joined(separator: " & ")
	}
}
