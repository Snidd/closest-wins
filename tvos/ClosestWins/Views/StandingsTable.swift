import ClosestWinsCore
import SwiftUI

/// The ranked table: place, player, rounds won, total distance (`StandingsTable.svelte`).
struct StandingsTable: View {
	@Environment(AppModel.self) private var model
	let rows: [StandingRow]
	/// Rank changes since the last round; empty on the final screen.
	var moves: [String: Movement] = [:]
	var columns = 1
	/// Font size in rem.
	var size: CGFloat = 1.25
	/// Rows shown; the rest become "+ n more".
	var max: Int = .max

	var body: some View {
		let t = model.t
		let shown = Array(rows.prefix(max))
		let perColumn = Int((Double(shown.count) / Double(columns)).rounded(.up))
		VStack(alignment: .leading, spacing: rem(size * 0.3)) {
			HStack(alignment: .top, spacing: rem(1.6)) {
				ForEach(0..<columns, id: \.self) { column in
					let slice = Array(shown.dropFirst(column * perColumn).prefix(perColumn))
					VStack(spacing: rem(size * 0.22)) {
						HStack(spacing: 0) {
							Spacer()
							Text(t.tv("wins").uppercased()).frame(width: rem(size * 3.4), alignment: .trailing)
							Text(t.tv("distance").uppercased()).frame(width: rem(size * 5.6), alignment: .trailing)
						}
						.font(.rem(size * 0.55, .bold))
						.tracking(rem(size * 0.05))
						.foregroundStyle(Theme.ink3)
						.padding(.horizontal, rem(size * 0.6))
						ForEach(slice, id: \.playerId) { row in
							line(row)
						}
					}
					.frame(maxWidth: .infinity, alignment: .top)
				}
			}
			if rows.count > shown.count {
				Text(t.tv("more", ["n": .int(rows.count - shown.count)]))
					.font(.rem(size * 0.8))
					.foregroundStyle(Theme.ink3)
					.padding(.leading, rem(size * 0.6))
			}
		}
	}

	private func line(_ row: StandingRow) -> some View {
		let t = model.t
		let move = moves[row.playerId]
		let leader = row.rank == 1 && row.roundsWon > 0
		return HStack(spacing: rem(size * 0.5)) {
			Text("\(row.rank)")
				.font(.rem(size, .heavy))
				.monospacedDigit()
				.foregroundStyle(leader ? Theme.gold : Theme.ink3)
				.frame(width: rem(size * 1.6))
			Avatar(nickname: row.nickname, color: row.color, size: rem(size * 1.6), offline: !row.connected)
			Text(row.nickname)
				.font(.rem(size, .bold))
				.foregroundStyle(row.connected ? Theme.ink : Theme.ink3)
				.lineLimit(1)
			if let move, move.wonRound {
				Text("+1")
					.font(.rem(size * 0.7, .heavy))
					.foregroundStyle(Theme.onGold)
					.padding(.horizontal, rem(size * 0.4))
					.background(Theme.gold, in: Capsule())
			}
			if let move, move.delta > 0 {
				Text("▲\(move.delta)")
					.font(.rem(size * 0.7, .heavy))
					.foregroundStyle(Theme.green)
					.accessibilityLabel(t.tv("movedUp", ["n": .int(move.delta)]))
			}
			Spacer(minLength: 0)
			Text("\(row.roundsWon)")
				.font(.rem(size * 1.35, .black))
				.monospacedDigit()
				.frame(width: rem(size * 2.6), alignment: .trailing)
			Text(row.guessedRounds > 0 ? t.km(row.totalDistanceKm) : "–")
				.font(.rem(size * 0.9, .medium))
				.monospacedDigit()
				.foregroundStyle(Theme.ink2)
				.lineLimit(1)
				.frame(width: rem(size * 5.6), alignment: .trailing)
		}
		.padding(.vertical, rem(size * 0.28))
		.padding(.horizontal, rem(size * 0.6))
		.background(
			leader
				? AnyShapeStyle(LinearGradient(colors: [Theme.gold.opacity(0.32), Theme.gold.opacity(0.06)], startPoint: .leading, endPoint: .trailing))
				: AnyShapeStyle(.white.opacity(0.04)),
			in: RoundedRectangle(cornerRadius: rem(size * 0.6))
		)
		.overlay(
			RoundedRectangle(cornerRadius: rem(size * 0.6))
				.stroke(.white.opacity(move?.wonRound == true ? 0.35 : 0), lineWidth: 1.5)
		)
	}
}
