import ClosestWinsCore
import SwiftUI

/// The end of the game: the winner, the final table, and the code that pairs this screen with
/// the next game (`FinishedScreen.svelte`).
struct FinishedScreen: View {
	@Environment(AppModel.self) private var model
	let snap: TvSnapshot
	let standings: [StandingRow]
	let winnerPlayerIds: [String]
	let endedEarly: Bool

	var body: some View {
		let t = model.t
		let winners = winnerPlayerIds.compactMap { id in standings.first { $0.playerId == id } }
		ZStack {
			if !winners.isEmpty {
				Confetti(colors: winners.map { Color(hex: $0.color) } + [Theme.gold, .white])
			}
			VStack(spacing: 2 * Theme.vh) {
				HStack(spacing: 3 * Theme.vw) {
					hero(winners).frame(maxWidth: .infinity, maxHeight: .infinity)
					VStack(alignment: .leading, spacing: rem(0.8)) {
						Eyebrow(text: t.tv("finalStandings"), size: 0.9)
						StandingsTable(
							rows: standings, size: standings.count <= 6 ? 1.25 : 1.05,
							max: standings.count > 9 ? 8 : 9)
						Spacer(minLength: 0)
					}
					.padding(rem(1.3))
					.frame(width: 38 * Theme.vw)
					.frame(maxHeight: .infinity)
					.background(Theme.panel, in: RoundedRectangle(cornerRadius: rem(1.5)))
					.overlay(RoundedRectangle(cornerRadius: rem(1.5)).stroke(Theme.line, lineWidth: 1))
				}
				HStack {
					Logo(size: 1.3, color: Theme.ink2)
					Spacer()
					if let code = snap.nextPairing?.pairingCode, !code.isEmpty {
						HStack(spacing: rem(0.6)) {
							Text(t.tv("nextGame")).foregroundStyle(Theme.ink2)
							Text(spaced(code)).font(.system(size: rem(1.4), weight: .heavy, design: .monospaced))
							Text("· \(model.serverHost)/host").foregroundStyle(Theme.ink2)
						}
						.font(.rem(1.1))
						.padding(.horizontal, rem(1.1))
						.padding(.vertical, rem(0.5))
						.glass(radius: 2)
					}
				}
			}
			.padding(.top, 4 * Theme.vh)
			.padding(.horizontal, 3 * Theme.vw)
			.padding(.bottom, 3 * Theme.vh)
		}
	}

	/// "730164" → "730 164".
	private func spaced(_ code: String) -> String {
		let half = code.count / 2
		return "\(code.prefix(half)) \(code.dropFirst(half))"
	}

	@ViewBuilder private func hero(_ winners: [StandingRow]) -> some View {
		let t = model.t
		VStack(spacing: rem(0.9)) {
			Eyebrow(text: t.common("finished"), size: 1.05)
			if winners.isEmpty {
				Image(systemName: "trophy").font(.rem(6)).foregroundStyle(Theme.ink3)
				Text(t.tv("noWinner")).font(.rem(3, .black))
				Text(t.tv("noWinnerHint")).font(.rem(1.3)).foregroundStyle(Theme.ink2)
			} else {
				let single = winners.count == 1
				let longest = winners.map(\.nickname.count).max() ?? 0
				let nameSize: CGFloat = single ? (longest <= 8 ? 6 : longest <= 12 ? 4.8 : 3.8) : (longest <= 8 ? 3 : 2.4)
				let avatar = single ? min(rem(11), 24 * Theme.vh) : min(rem(7), 16 * Theme.vh)
				HStack(alignment: .top, spacing: rem(2)) {
					ForEach(winners, id: \.playerId) { winner in
						VStack(spacing: rem(0.3)) {
							Crown(size: avatar * 0.32)
							Avatar(nickname: winner.nickname, color: winner.color, size: avatar, ring: true)
								.shadow(color: Color(hex: winner.color).opacity(0.6), radius: avatar * 0.25)
							Text(winner.nickname)
								.font(.rem(nameSize, .black))
								.foregroundStyle(Color(hex: winner.color, keep: 0.55))
								.lineLimit(1)
								.minimumScaleFactor(0.5)
						}
					}
				}
				Text(single ? t.tv("winsGame") : t.tv("sharedVictory"))
					.font(.rem(2.4, .heavy))
					.foregroundStyle(Theme.gold)
				let first = winners[0]
				Text(
					t.tv("roundsWon", ["n": .int(first.roundsWon)])
						+ (single && first.guessedRounds > 0 ? " · " + t.tv("totalKm", ["km": .text(t.km(first.totalDistanceKm))]) : "")
				)
				.font(.rem(1.3))
				.foregroundStyle(Theme.ink2)
			}
			if endedEarly {
				Text(t.tv("endedEarly"))
					.font(.rem(0.95, .semibold))
					.foregroundStyle(Theme.ink2)
					.padding(.horizontal, rem(0.9))
					.padding(.vertical, rem(0.3))
					.background(.white.opacity(0.08), in: Capsule())
			}
		}
	}
}

/// Falling confetti behind the winner. Off when the system asks for reduced motion.
struct Confetti: View {
	@Environment(\.accessibilityReduceMotion) private var reduceMotion
	let colors: [Color]

	private struct Piece {
		let x, y, speed, sway, phase, spin, size: Double
		let round: Bool
		let color: Int
	}

	@State private var pieces: [Piece] = (0..<80).map { _ in
		Piece(
			x: .random(in: 0...1), y: .random(in: -0.2...1), speed: .random(in: 0.6...1.5),
			sway: .random(in: 0.5...1), phase: .random(in: 0...(2 * .pi)), spin: .random(in: -3...3),
			size: .random(in: 0.7...1.3), round: .random(in: 0...1) < 0.28, color: .random(in: 0..<64))
	}

	var body: some View {
		if !reduceMotion {
			TimelineView(.animation) { context in
				Canvas { g, canvas in
					let time = context.date.timeIntervalSinceReferenceDate
					let (width, height) = (Double(canvas.width), Double(canvas.height))
					let unit: Double = max(6, min(width, height) / 70)
					let span: Double = height * 1.2
					for piece in pieces {
						let fallen = (piece.y * span + time * piece.speed * unit * 6).truncatingRemainder(dividingBy: span)
						let sway: Double = sin(time * 1.3 + piece.phase) * unit * 2.2 * piece.sway
						let x: Double = piece.x * width + sway
						let y: Double = fallen - height * 0.2
						var layer = g
						layer.opacity = 0.9
						layer.translateBy(x: x, y: y)
						let side = unit * piece.size
						let color = colors[piece.color % colors.count]
						if piece.round {
							layer.fill(Path(ellipseIn: CGRect(x: -side / 2, y: -side / 2, width: side, height: side)), with: .color(color))
						} else {
							layer.rotate(by: .radians(time * piece.spin + piece.phase))
							// A tumbling rectangle: its height breathes as it turns.
							let tall: Double = max(1, side * 0.6 * abs(cos(time * 2 + piece.phase)))
							layer.fill(Path(CGRect(x: -side / 2, y: -tall / 2, width: side, height: tall)), with: .color(color))
						}
					}
				}
			}
			.allowsHitTesting(false)
		}
	}
}
