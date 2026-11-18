import ClosestWinsCore
import SwiftUI

/// Waiting for players: the join QR code and the growing player list (`LobbyScreen.svelte`).
/// In a teams game the players appear under their team's heading (every team, empty ones included).
struct LobbyScreen: View {
	@Environment(AppModel.self) private var model
	let snap: TvSnapshot

	private let qrSize = min(60 * Theme.vh, 36 * Theme.vw)

	var body: some View {
		HStack(spacing: 4 * Theme.vw) {
			join.frame(width: qrSize + 3 * Theme.vh)
			main.frame(maxWidth: .infinity, maxHeight: .infinity)
		}
		.padding(.vertical, 5 * Theme.vh)
		.padding(.horizontal, 4 * Theme.vw)
	}

	private var join: some View {
		let t = model.t
		return VStack(spacing: rem(0.7)) {
			QrCode(value: snap.game.joinUrl)
				.padding(1.5 * Theme.vh)
				.background(.white, in: RoundedRectangle(cornerRadius: 1.6 * Theme.vh))
				.overlay(
					RoundedRectangle(cornerRadius: 1.6 * Theme.vh)
						.stroke(Theme.gold.opacity(0.9), lineWidth: 0.35 * Theme.vh)
				)
				.shadow(color: .black.opacity(0.45), radius: 30, y: 16)
				.padding(.bottom, rem(0.5))
			Text(t.tv("scanToJoin")).font(.rem(1.9, .heavy))
			HStack(spacing: rem(0.35)) {
				Text(t.tv("orGoTo"))
				Text(shortJoinUrl(snap.game.joinUrl)).fontWeight(.bold).foregroundStyle(Theme.ink)
				Text(t.tv("andEnter"))
			}
			.font(.rem(1.1))
			.foregroundStyle(Theme.ink2)
			.lineLimit(1)
			.minimumScaleFactor(0.7)
			CodeTiles(code: snap.game.joinCode, size: min(rem(3.4), 8 * Theme.vh))
				.accessibilityElement()
				.accessibilityLabel("\(t.tv("joinCode")) \(snap.game.joinCode)")
		}
	}

	private var main: some View {
		let t = model.t
		let playlist = snap.game.playlistName.name(model.lang)
		return VStack(alignment: .leading, spacing: 3 * Theme.vh) {
			VStack(alignment: .leading, spacing: rem(0.4)) {
				Logo(size: 1.6, color: Theme.ink2)
				if !playlist.isEmpty {
					Eyebrow(text: t.tv("playlist"), size: 0.9).padding(.top, rem(0.8))
					Text(playlist)
						.font(.rem(3.2, .heavy))
						.lineLimit(2)
						.minimumScaleFactor(0.6)
					Text(t.tv("roundsAndTimer", ["rounds": .int(snap.game.totalRounds), "seconds": .int(snap.game.timerSeconds)]))
						.font(.rem(1.15))
						.foregroundStyle(Theme.ink2)
				}
			}

			roster
				.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
				.padding(.vertical, 2.4 * Theme.vh)
				.padding(.horizontal, 2 * Theme.vw)
				.background(.white.opacity(0.045), in: RoundedRectangle(cornerRadius: rem(1.4)))
				.overlay(RoundedRectangle(cornerRadius: rem(1.4)).stroke(Theme.line, lineWidth: 1))

			HStack(spacing: rem(0.7)) {
				WaitingDots()
				Text(t.tv("waitingForHost")).font(.rem(1.35, .semibold)).foregroundStyle(Theme.ink2)
			}
		}
	}

	private var roster: some View {
		let t = model.t
		let players = snap.players
		// Chips shrink as the lobby fills, so 40 players still fit.
		let (width, font): (CGFloat, CGFloat) =
			switch players.count {
			case ...8: (13, 1.5)
			case ...15: (10.5, 1.2)
			case ...24: (9, 1)
			default: (7.4, 0.82)
			}
		return VStack(alignment: .leading, spacing: rem(0.8)) {
			HStack(alignment: .firstTextBaseline, spacing: rem(0.5)) {
				Text("\(players.count)")
					.font(.rem(3.6, .black))
					.foregroundStyle(LinearGradient(colors: [.white, Color(hex: "#9fb4d6")], startPoint: .top, endPoint: .bottom))
					.contentTransition(.numericText())
				Text(t.common("players").uppercased())
					.font(.rem(1, .bold))
					.tracking(rem(0.14))
					.foregroundStyle(Theme.ink2)
				Text("/ \(model.shared.game.maxPlayers)").font(.rem(1)).foregroundStyle(Theme.ink3)
			}
			if let teams = snap.game.teams {
				LazyVGrid(columns: [GridItem(.adaptive(minimum: rem(13)), spacing: rem(0.8))], alignment: .leading, spacing: rem(0.8)) {
					ForEach(teams, id: \.index) { team in
						teamCard(team, members: players.filter { $0.team == team.index }, font: min(font, 1.2))
					}
				}
				.animation(.spring(duration: 0.6, bounce: 0.4), value: players.map(\.id))
			} else if players.isEmpty {
				Text(t.tv("waitingForPlayers"))
					.font(.rem(1.4))
					.foregroundStyle(Theme.ink3)
					.frame(maxWidth: .infinity, maxHeight: .infinity)
			} else {
				LazyVGrid(columns: [GridItem(.adaptive(minimum: rem(width)), spacing: rem(0.6))], alignment: .leading, spacing: rem(0.6)) {
					ForEach(players) { player in
						chip(player, font: font)
					}
				}
				.animation(.spring(duration: 0.6, bounce: 0.4), value: players.map(\.id))
			}
		}
		.animation(.easeOut(duration: 0.3), value: players.count)
	}

	private func chip(_ player: Player, font: CGFloat) -> some View {
		HStack(spacing: rem(font * 0.5)) {
			Avatar(nickname: player.nickname, color: player.color, size: rem(font * 1.7), offline: !player.connected)
			Text(player.nickname)
				.font(.rem(font, .bold))
				.foregroundStyle(player.connected ? Theme.ink : Theme.ink3)
				.lineLimit(1)
			Spacer(minLength: 0)
		}
		.padding(.vertical, rem(font * 0.25))
		.padding(.leading, rem(font * 0.3))
		.padding(.trailing, rem(font * 0.7))
		.background(.white.opacity(0.07), in: Capsule())
		.transition(.scale(scale: 0.4).combined(with: .opacity))
	}

	/// A team's heading with its player count, and its players one per line.
	private func teamCard(_ team: TeamInfo, members: [Player], font: CGFloat) -> some View {
		VStack(alignment: .leading, spacing: rem(0.5)) {
			HStack(alignment: .firstTextBaseline, spacing: rem(0.6)) {
				Text(model.t.teamName(team.index, team.name))
					.font(.rem(1.5, .heavy))
					.lineLimit(1)
				Text("\(members.count)")
					.font(.rem(1, .bold))
					.monospacedDigit()
					.foregroundStyle(Theme.ink3)
			}
			ForEach(members) { player in
				chip(player, font: font)
			}
		}
		.frame(maxWidth: .infinity, alignment: .topLeading)
		.padding(.vertical, 1.4 * Theme.vh)
		.padding(.horizontal, 1 * Theme.vw)
		.background(.white.opacity(0.05), in: RoundedRectangle(cornerRadius: rem(1)))
	}
}

/// A code as one gold tile per character (the join code).
struct CodeTiles: View {
	let code: String
	/// Font size in points.
	let size: CGFloat

	var body: some View {
		HStack(spacing: size * 0.14) {
			ForEach(Array(code.enumerated()), id: \.offset) { _, ch in
				Text(String(ch))
					.font(.system(size: size, weight: .black, design: .monospaced))
					.foregroundStyle(Theme.onGold)
					.frame(width: size * 1.15, height: size * 1.3)
					.background(
						LinearGradient(colors: [Color(hex: "#ffd76a"), Theme.gold], startPoint: .top, endPoint: .bottom),
						in: RoundedRectangle(cornerRadius: size * 0.18)
					)
			}
		}
	}
}

/// Three dots taking turns: "still waiting".
struct WaitingDots: View {
	var body: some View {
		TimelineView(.animation) { context in
			let time = context.date.timeIntervalSinceReferenceDate
			HStack(spacing: rem(0.3)) {
				ForEach(0..<3, id: \.self) { i in
					Circle()
						.fill(Theme.gold)
						.frame(width: rem(0.5), height: rem(0.5))
						.offset(y: -rem(0.3) * max(0, sin(time * 4 - Double(i) * 0.7)))
				}
			}
		}
	}
}
