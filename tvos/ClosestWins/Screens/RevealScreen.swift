import ClosestWinsCore
import SwiftUI

/// The reveal (`RevealScreen.svelte`): guesses on the map, then the answer, then who was
/// closest. The stages follow the server's timestamps (`RevealTiming`), so the TV and the
/// phones move together. Nothing that gives the answer away is shown before `lines`.
struct RevealScreen: View {
	@Environment(AppModel.self) private var model
	let snap: TvSnapshot
	let result: RoundResult

	/// The furthest stage shown so far. Stages never go back, whatever a new snapshot does to
	/// the clock offset.
	@State private var reached: RevealStage
	/// Shown after the choreography had finished (skipped, or the app started late): no build-up.
	@State private var instant: Bool

	private let panelWidth = min(rem(27), 34 * Theme.vw)
	private let margin = 2.4 * Theme.vh

	init(snap: TvSnapshot, result: RoundResult, model: AppModel) {
		self.snap = snap
		self.result = result
		let reveal = model.shared.reveal
		let stage = RevealTiming(result, now: model.clock.now(), flyMs: reveal.flyMs, linesMs: reveal.linesMs).stage
		_reached = State(initialValue: stage)
		_instant = State(initialValue: stage == .done)
	}

	private func timing(_ date: Date = Date()) -> RevealTiming {
		let reveal = model.shared.reveal
		return RevealTiming(result, now: model.clock.now(date), flyMs: reveal.flyMs, linesMs: reveal.linesMs)
	}

	/// What the stage timer depends on: it starts over when any of this changes.
	private struct TimerKey: Equatable {
		let revealStartedAt, answerVisibleAt, offsetMs: Double
		let skipped: Bool
	}

	var body: some View {
		let stage = max(reached, timing().stage)
		ZStack {
			RevealMap(
				result: result, players: snap.players, stage: stage,
				insets: EdgeInsets(
					top: rem(5.6), leading: 2 * Theme.vw,
					bottom: min(rem(11.5), 34 * Theme.vh), trailing: panelWidth + 3 * Theme.vw))
			shade
			header
			caption(stage)
			if stage == .done {
				results
					.transition(.move(edge: .trailing).combined(with: .opacity))
			}
		}
		.animation(.easeOut(duration: instant ? 0.4 : 0.7), value: stage)
		.task(
			id: TimerKey(
				revealStartedAt: result.revealStartedAt, answerVisibleAt: result.answerVisibleAt,
				offsetMs: model.clock.offsetMs, skipped: result.skipped)
		) {
			// One wake-up per stage boundary.
			while !Task.isCancelled {
				let now = timing()
				if now.stage > reached { reached = now.stage }
				guard now.endsAt.isFinite else { return }
				let wait = max(16, now.endsAt - model.clock.now() + 30)
				try? await Task.sleep(for: .milliseconds(wait))
			}
		}
	}

	/// Darkens the top and bottom of the map behind the text.
	private var shade: some View {
		let dark = Color(red: 4 / 255, green: 9 / 255, blue: 20 / 255)
		return VStack(spacing: 0) {
			LinearGradient(colors: [dark.opacity(0.55), dark.opacity(0)], startPoint: .top, endPoint: .bottom)
				.frame(height: 16 * Theme.vh)
			Spacer()
			LinearGradient(colors: [dark.opacity(0), dark.opacity(0.5), dark.opacity(0.85)], startPoint: .top, endPoint: .bottom)
				.frame(height: min(rem(13), 38 * Theme.vh))
		}
		.allowsHitTesting(false)
	}

	private var header: some View {
		let t = model.t
		let suddenDeath = result.round.isSuddenDeath
		return HStack(spacing: rem(0.8)) {
			JoinBug(game: snap.game)
			Text(
				suddenDeath
					? t.tv("suddenDeath")
					: t.common("roundOf", ["n": .int(result.round.number), "total": .int(snap.game.totalRounds)])
			)
			.font(.rem(1.1, .heavy))
			.padding(.horizontal, rem(1))
			.padding(.vertical, rem(0.45))
			.background(suddenDeath ? AnyShapeStyle(Theme.red) : AnyShapeStyle(Theme.glass), in: Capsule())
			.overlay(Capsule().stroke(Theme.line, lineWidth: 1))
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
		.padding(.top, margin)
		.padding(.leading, 2 * Theme.vw)
	}

	/// The words at the bottom: the build-up, then the place itself.
	@ViewBuilder private func caption(_ stage: RevealStage) -> some View {
		let t = model.t
		switch stage {
		case .pins:
			VStack(spacing: rem(0.5)) {
				Text(result.guesses.isEmpty ? t.tv("noGuessesOnMap") : t.tv("revealPins"))
					.font(.rem(3.4, .black))
				TimelineView(.animation) { context in
					// Counts the pins on the map so far.
					let now = model.clock.now(context.date)
					VStack(spacing: rem(0.5)) {
						Text(t.tv("guessCount", ["n": .int(result.guesses.filter { $0.revealAt <= now }.count)]))
							.font(.rem(1.3))
							.foregroundStyle(Theme.ink2)
						Capsule()
							.fill(.white.opacity(0.15))
							.frame(width: min(rem(30), 50 * Theme.vw), height: rem(0.4))
							.overlay(alignment: .leading) {
								Capsule()
									.fill(Theme.gold)
									.frame(width: min(rem(30), 50 * Theme.vw) * progress(at: context.date))
							}
					}
				}
			}
			.shadow(color: .black.opacity(0.6), radius: 10)
			.frame(maxHeight: .infinity, alignment: .bottom)
			.padding(.bottom, 5 * Theme.vh)
			.transition(.opacity)
		case .flying:
			Text(t.tv("revealFlying"))
				.font(.rem(3.4, .black))
				.foregroundStyle(Theme.gold)
				.shadow(color: .black.opacity(0.6), radius: 10)
				.frame(maxHeight: .infinity, alignment: .bottom)
				.padding(.bottom, 7 * Theme.vh)
				.transition(.opacity)
		case .lines, .done:
			place
				.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
				.padding(.leading, 2.6 * Theme.vw)
				.padding(.trailing, panelWidth + 4 * Theme.vw)
				.padding(.bottom, 4 * Theme.vh)
				.transition(.opacity.combined(with: .scale(scale: instant ? 1 : 1.15, anchor: .bottomLeading)))
		}
	}

	private func progress(at date: Date) -> Double {
		let now = timing(date)
		return now.stage == .pins ? now.progress : 1
	}

	/// The answer: the place, a fact about it, and from now on the photo credit.
	private var place: some View {
		let name = result.target.name(model.lang)
		let fact = result.target.fact(model.lang)
		let nameSize: CGFloat = name.count <= 18 ? 4 : name.count <= 30 ? 3.2 : 2.5
		let factSize: CGFloat = fact.count <= 110 ? 1.45 : fact.count <= 220 ? 1.2 : fact.count <= 400 ? 1.02 : 0.9
		return VStack(alignment: .leading, spacing: rem(0.4)) {
			Text(name)
				.font(.rem(nameSize, .black))
				.lineLimit(2)
				.minimumScaleFactor(0.6)
			Capsule().fill(Theme.gold).frame(width: rem(6), height: rem(0.3))
			if !fact.isEmpty {
				Text(fact)
					.font(.rem(factSize, .medium))
					.foregroundStyle(Theme.ink2)
					.lineLimit(4)
					.frame(maxWidth: rem(factSize * 30), alignment: .leading)
					.padding(.top, rem(0.2))
			}
			if let credit = result.round.clue.photo?.attribution, !credit.isEmpty {
				Text("\(model.t.tv("photoCredit")): \(credit)")
					.font(.rem(0.72))
					.foregroundStyle(Theme.ink3)
					.lineLimit(1)
			}
		}
		.shadow(color: .black.opacity(0.7), radius: 10)
	}

	/// Who won the round and how close everyone was.
	private var results: some View {
		let t = model.t
		let winners = result.winnerPlayerIds.compactMap(snap.player)
		let shown = Array(result.guesses.prefix(winners.count > 1 ? 7 : 8))
		return VStack(alignment: .leading, spacing: rem(0.9)) {
			VStack(spacing: rem(0.4)) {
				if winners.isEmpty {
					Image(systemName: "scope").font(.rem(3)).foregroundStyle(Theme.ink3)
					Text(t.tv("nobodyGuessed")).font(.rem(1.5, .heavy)).multilineTextAlignment(.center)
					Text(t.tv("noPointThisRound")).font(.rem(1)).foregroundStyle(Theme.ink2)
				} else {
					HStack(spacing: rem(0.8)) {
						ForEach(winners) { player in
							VStack(spacing: 0) {
								Crown(size: rem(winners.count > 1 ? 1.2 : 1.5))
								Avatar(
									nickname: player.nickname, color: player.color,
									size: rem(winners.count > 1 ? 3.6 : 4.6), ring: true)
							}
						}
					}
					FlowLayout(spacing: rem(0.4), centered: true) {
						ForEach(Array(winners.enumerated()), id: \.element.id) { index, player in
							if index > 0 { Text("&").foregroundStyle(Theme.ink2) }
							Text(player.nickname).foregroundStyle(Color(hex: player.color, keep: 0.6))
						}
					}
					.font(.rem(2.2, .black))
					Text(winners.count > 1 ? t.tv("shareRound") : t.tv("winsRound"))
						.font(.rem(1.2, .bold))
						.foregroundStyle(Theme.gold)
					if let km = result.guesses.first(where: { $0.isWinner })?.distanceKm {
						Text(t.tv("away", ["km": .text(t.km(km))])).font(.rem(1.05)).foregroundStyle(Theme.ink2)
					}
					if let teams = result.winnerTeams, !teams.isEmpty {
						Text(t.common("teamTookRound", ["team": .text(t.teamNames(teams, of: snap.game))]))
							.font(.rem(1.3, .heavy))
							.foregroundStyle(Theme.onGold)
							.multilineTextAlignment(.center)
							.padding(.horizontal, rem(1))
							.padding(.vertical, rem(0.25))
							.background(Theme.gold, in: Capsule())
							.padding(.top, rem(0.4))
					}
				}
			}
			.frame(maxWidth: .infinity)
			.padding(.vertical, rem(1))
			.background(.white.opacity(0.05), in: RoundedRectangle(cornerRadius: rem(1.2)))

			if !result.guesses.isEmpty {
				Eyebrow(text: t.tv("closest"), color: Theme.ink3, size: 0.8)
				VStack(spacing: rem(0.25)) {
					ForEach(shown, id: \.playerId) { guess in
						let player = snap.player(guess.playerId)
						HStack(spacing: rem(0.5)) {
							Text("\(guess.rank)")
								.font(.rem(1, .heavy))
								.foregroundStyle(guess.isWinner ? Theme.gold : Theme.ink3)
								.frame(width: rem(1.6))
							Avatar(nickname: player?.nickname ?? "?", color: player?.color ?? "#888888", size: rem(1.45))
							Text(player?.nickname ?? "").font(.rem(1.05, .bold)).lineLimit(1)
							Spacer(minLength: rem(0.4))
							Text(t.km(guess.distanceKm)).font(.rem(1.05, .medium)).monospacedDigit().foregroundStyle(Theme.ink2)
						}
						.padding(.vertical, rem(0.25))
						.padding(.horizontal, rem(0.5))
						.background(guess.isWinner ? Theme.gold.opacity(0.14) : .clear, in: RoundedRectangle(cornerRadius: rem(0.6)))
						.overlay(
							RoundedRectangle(cornerRadius: rem(0.6)).stroke(Theme.gold.opacity(guess.isWinner ? 0.45 : 0), lineWidth: 1)
						)
					}
				}
				if result.guesses.count > shown.count {
					Text(t.tv("more", ["n": .int(result.guesses.count - shown.count)]))
						.font(.rem(0.9))
						.foregroundStyle(Theme.ink3)
				}
			}
			if !result.noGuessPlayerIds.isEmpty {
				Text(t.tv("withoutGuess", ["n": .int(result.noGuessPlayerIds.count)]))
					.font(.rem(0.9))
					.foregroundStyle(Theme.ink3)
			}
		}
		.padding(rem(1.2))
		.frame(width: panelWidth)
		.background(Theme.panel, in: RoundedRectangle(cornerRadius: rem(1.6)))
		.overlay(RoundedRectangle(cornerRadius: rem(1.6)).stroke(Theme.line, lineWidth: 1))
		.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
		.padding(.top, margin + rem(1.2))
		.padding(.trailing, 2 * Theme.vw)
	}
}
