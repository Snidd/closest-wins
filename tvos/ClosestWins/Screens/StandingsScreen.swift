import ClosestWinsCore
import SwiftUI

/// Between rounds: the table, what just happened and what comes next (`StandingsScreen.svelte`).
struct StandingsScreen: View {
	@Environment(AppModel.self) private var model
	let snap: TvSnapshot
	let result: RoundResult
	let standings: [StandingRow]
	let next: NextStep

	private var suddenDeathNext: Bool {
		if case .suddenDeath = next { true } else { false }
	}

	private var finishNext: Bool {
		if case .finish = next { true } else { false }
	}

	var body: some View {
		let t = model.t
		// With many players the board takes the full width and the cards go underneath.
		let wide = standings.count > 18
		VStack(spacing: 2 * Theme.vh) {
			ZStack {
				HStack {
					JoinBug(game: snap.game)
					Spacer()
				}
				VStack(spacing: rem(0.2)) {
					Eyebrow(
						text: result.round.isSuddenDeath
							? t.tv("afterSuddenDeath", ["n": .int(result.round.number)])
							: t.tv("afterRound", ["n": .int(result.round.number), "total": .int(snap.game.totalRounds)]),
						size: 1)
					Text(suddenDeathNext ? t.tv("tiedAtTop") : t.tv("standings"))
						.font(.rem(3.4, .black))
						.foregroundStyle(suddenDeathNext ? Color(hex: "#ff8a95") : Theme.ink)
				}
			}

			if wide {
				VStack(spacing: 2 * Theme.vh) {
					board(columns: 3, size: standings.count > 30 ? 0.85 : 1.05)
					HStack(alignment: .top, spacing: rem(1)) {
						recap
						nextCard
						if !finishNext { joinCard(compact: true) }
					}
					.fixedSize(horizontal: false, vertical: true)
				}
			} else {
				HStack(alignment: .top, spacing: 2.4 * Theme.vw) {
					board(columns: standings.count <= 9 ? 1 : 2, size: standings.count <= 6 ? 1.6 : standings.count <= 9 ? 1.25 : 1.05)
					VStack(spacing: rem(1)) {
						recap
						nextCard
						Spacer(minLength: 0)
						if !finishNext { joinCard(compact: false) }
					}
					.frame(width: min(rem(23), 30 * Theme.vw))
				}
			}
		}
		.padding(.top, 2.6 * Theme.vh)
		.padding(.horizontal, 2.4 * Theme.vw)
		.padding(.bottom, 3 * Theme.vh)
	}

	private func board(columns: Int, size: CGFloat) -> some View {
		StandingsTable(
			rows: standings, moves: movement(standings: standings, result: result), columns: columns, size: size,
			teams: snap.teamStandings, highlightTeams: result.winnerTeams ?? [])
			.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
			.padding(rem(1.2))
			.background(.white.opacity(0.035), in: RoundedRectangle(cornerRadius: rem(1.5)))
			.overlay(RoundedRectangle(cornerRadius: rem(1.5)).stroke(Theme.line, lineWidth: 1))
	}

	/// The round that was just played: the place and who won it.
	private var recap: some View {
		let t = model.t
		let winners = result.winnerPlayerIds.compactMap(snap.player)
		let winKm = result.guesses.first { $0.isWinner }?.distanceKm
		return VStack(alignment: .leading, spacing: rem(0.4)) {
			Eyebrow(text: t.tv("lastRound"), color: Theme.ink3, size: 0.8)
			Text(result.target.name(model.lang)).font(.rem(1.5, .heavy)).lineLimit(2)
			if winners.isEmpty {
				Text(t.tv("nobodyGuessed")).font(.rem(1)).foregroundStyle(Theme.ink2)
			} else {
				FlowLayout(spacing: rem(0.35)) {
					Text(t.tv("wonBy")).foregroundStyle(Theme.ink2)
					ForEach(Array(winners.enumerated()), id: \.element.id) { index, player in
						if index > 0 { Text("&").foregroundStyle(Theme.ink2) }
						HStack(spacing: rem(0.3)) {
							Avatar(nickname: player.nickname, color: player.color, size: rem(1.3))
							Text(player.nickname).fontWeight(.heavy)
						}
					}
					if let winKm { Text("· \(t.km(winKm))").foregroundStyle(Theme.ink2) }
				}
				.font(.rem(1))
				if let teams = result.winnerTeams, !teams.isEmpty {
					Text(t.common("teamTookRound", ["team": .text(t.teamNames(teams, of: snap.game))]))
						.font(.rem(1, .heavy))
						.foregroundStyle(Theme.gold)
				}
			}
		}
		.frame(maxWidth: .infinity, alignment: .leading)
		.padding(rem(1.1))
		.glass()
	}

	@ViewBuilder private var nextCard: some View {
		let t = model.t
		switch next {
		case .round(let number):
			card(tint: Theme.gold) {
				Eyebrow(text: t.tv("upNext"), size: 0.8)
				HStack(alignment: .firstTextBaseline, spacing: rem(0.4)) {
					Text(t.common("round")).font(.rem(1.6, .bold))
					Text("\(number)").font(.rem(2.6, .black))
					Text("/ \(snap.game.totalRounds)").font(.rem(1.4)).foregroundStyle(Theme.ink3)
				}
			}
		case .suddenDeath(let ids, let teams):
			card(tint: Theme.red) {
				HStack(spacing: rem(0.4)) {
					Image(systemName: "bolt.fill").foregroundStyle(Theme.red)
					Eyebrow(text: t.tv("upNext"), color: Color(hex: "#ff8a95"), size: 0.8)
				}
				Text(t.tv("suddenDeath")).font(.rem(2, .black))
				if let teams {
					TeamDuel(teams: teams, game: snap.game, size: 1.15)
				} else {
					Duellists(players: ids.compactMap(snap.player), size: 1.15)
				}
				Text(teams != nil ? t.tv("duelHintTeams") : t.tv("duelHint"))
					.font(.rem(0.9))
					.foregroundStyle(Theme.ink2)
					.fixedSize(horizontal: false, vertical: true)
			}
		case .finish:
			card(tint: Theme.gold) {
				Eyebrow(text: t.tv("upNext"), size: 0.8)
				HStack(spacing: rem(0.5)) {
					Image(systemName: "trophy.fill").foregroundStyle(Theme.gold)
					Text(t.tv("finalResult")).fontWeight(.black)
				}
				.font(.rem(1.8))
			}
		}
	}

	private func card(tint: Color, @ViewBuilder content: () -> some View) -> some View {
		VStack(alignment: .leading, spacing: rem(0.45), content: content)
			.frame(maxWidth: .infinity, alignment: .leading)
			.padding(rem(1.1))
			.background(
				LinearGradient(colors: [tint.opacity(0.22), tint.opacity(0.05)], startPoint: .topLeading, endPoint: .bottomTrailing),
				in: RoundedRectangle(cornerRadius: rem(1.3))
			)
			.glass()
	}

	/// Latecomers can still join before the next round.
	private func joinCard(compact: Bool) -> some View {
		let t = model.t
		let side = compact ? min(rem(5.5), 11 * Theme.vh) : min(rem(7.5), 16 * Theme.vh)
		return HStack(spacing: rem(0.9)) {
			QrCode(value: snap.game.joinUrl)
				.frame(width: side, height: side)
				.padding(rem(0.25))
				.background(.white, in: RoundedRectangle(cornerRadius: rem(0.5)))
			VStack(alignment: .leading, spacing: rem(0.2)) {
				Text(t.tv("joinNextRound")).font(.rem(0.95)).foregroundStyle(Theme.ink2)
				Text(snap.game.joinCode)
					.font(.system(size: rem(compact ? 1.6 : 2), weight: .black, design: .monospaced))
					.tracking(rem(0.15))
					.foregroundStyle(Theme.gold)
			}
			Spacer(minLength: 0)
		}
		.frame(maxWidth: .infinity, alignment: .leading)
		.padding(rem(0.9))
		.glass()
	}
}
