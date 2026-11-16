import ClosestWinsCore
import SwiftUI

/// A running round: the clue, the countdown and who has locked in (`RoundScreen.svelte`).
/// The answer is not in the snapshot yet, and neither is the photo credit.
struct RoundScreen: View {
	@Environment(AppModel.self) private var model
	let snap: TvSnapshot
	let round: ActiveRound
	let lockedPlayerIds: [String]

	var body: some View {
		TimelineView(.periodic(from: .now, by: 0.1)) { context in
			content(secondsLeft: Int((model.clock.remainingMs(until: round.endsAt, local: context.date) / 1000).rounded(.up)))
		}
	}

	/// The last seconds turn red: a third of the round, between 3 and 10 seconds.
	private var urgentBelow: Int {
		min(10, max(3, Int((round.endsAt - round.startedAt) / 1000 / 3)))
	}

	private func content(secondsLeft: Int) -> some View {
		let timeUp = secondsLeft == 0
		let urgent = secondsLeft > 0 && secondsLeft <= urgentBelow
		return VStack(spacing: 2.2 * Theme.vh) {
			ZStack {
				HStack {
					JoinBug(game: snap.game)
					Spacer()
					TimerRing(startedAt: round.startedAt, endsAt: round.endsAt, urgentBelow: urgentBelow)
						.frame(width: 17 * Theme.vh, height: 17 * Theme.vh)
				}
				title
			}
			.frame(height: 17 * Theme.vh)

			ClueView(clue: round.clue)
				.frame(maxWidth: .infinity, maxHeight: .infinity)
				.overlay {
					if timeUp {
						ZStack {
							RoundedRectangle(cornerRadius: rem(1.4)).fill(Color(red: 5 / 255, green: 10 / 255, blue: 20 / 255).opacity(0.55))
							Text(model.t.tv("timeUp"))
								.font(.rem(5.5, .black))
								.shadow(color: .black.opacity(0.5), radius: 12)
						}
						.transition(.scale(scale: 1.6).combined(with: .opacity))
					}
				}
				.animation(.easeOut(duration: 0.5), value: timeUp)

			PlayersBar(
				players: snap.players, lockedIds: lockedPlayerIds,
				eligibleIds: round.eligiblePlayerIds, duel: round.isSuddenDeath
			)
		}
		.padding(.top, 2.6 * Theme.vh)
		.padding(.horizontal, 2.4 * Theme.vw)
		.padding(.bottom, 2.8 * Theme.vh)
		.overlay {
			// A red edge while time runs out.
			if urgent {
				Rectangle()
					.stroke(Color(red: 1, green: 50 / 255, blue: 70 / 255).opacity(0.5), lineWidth: 40)
					.blur(radius: 60)
					.allowsHitTesting(false)
			}
		}
	}

	@ViewBuilder private var title: some View {
		let t = model.t
		if round.isSuddenDeath {
			VStack(spacing: rem(0.5)) {
				HStack(spacing: rem(0.4)) {
					Image(systemName: "bolt.fill")
					Text((t.tv("suddenDeath") + (round.number > 1 ? " \(round.number)" : "")).uppercased())
						.tracking(rem(0.12))
				}
				.font(.rem(1.05, .heavy))
				.foregroundStyle(.white)
				.padding(.horizontal, rem(1.1))
				.padding(.vertical, rem(0.35))
				.background(Theme.red, in: Capsule())
				.shadow(color: Theme.red.opacity(0.6), radius: 16)
				Duellists(players: round.eligiblePlayerIds.compactMap(snap.player), size: 2)
			}
		} else {
			VStack(spacing: rem(0.2)) {
				Eyebrow(text: t.common("round"), size: 1)
				HStack(alignment: .firstTextBaseline, spacing: rem(0.4)) {
					Text("\(round.number)").font(.rem(3.5, .black))
					Text("/ \(snap.game.totalRounds)").font(.rem(2.2)).foregroundStyle(Theme.ink3)
				}
				if snap.game.totalRounds <= 20 {
					HStack(spacing: rem(0.4)) {
						ForEach(1...max(1, snap.game.totalRounds), id: \.self) { n in
							Circle()
								.fill(n == round.number ? Theme.gold : .white.opacity(n < round.number ? 0.55 : 0.18))
								.frame(width: rem(0.5), height: rem(0.5))
								.shadow(color: n == round.number ? Theme.gold : .clear, radius: 6)
						}
					}
				}
			}
		}
	}
}

/// The players of a sudden death, joined by "vs".
struct Duellists: View {
	@Environment(AppModel.self) private var model
	let players: [Player]
	/// Font size in rem.
	let size: CGFloat

	var body: some View {
		HStack(spacing: rem(size * 0.4)) {
			ForEach(Array(players.enumerated()), id: \.element.id) { index, player in
				if index > 0 {
					Text(model.t.tv("versus").uppercased()).font(.rem(size * 0.6, .bold)).foregroundStyle(Theme.ink3)
				}
				HStack(spacing: rem(size * 0.3)) {
					Avatar(nickname: player.nickname, color: player.color, size: rem(size * 1.2), ring: true)
					Text(player.nickname)
						.font(.rem(size, .heavy))
						.foregroundStyle(Color(hex: player.color, keep: 0.55))
						.lineLimit(1)
				}
			}
		}
	}
}

/// The countdown: a ring that drains and the seconds left (`TimerRing.svelte`).
struct TimerRing: View {
	@Environment(AppModel.self) private var model
	let startedAt: EpochMs
	let endsAt: EpochMs
	let urgentBelow: Int

	var body: some View {
		TimelineView(.animation) { context in
			let total = max(1, endsAt - startedAt)
			let left = min(total, model.clock.remainingMs(until: endsAt, local: context.date))
			let seconds = Int((left / 1000).rounded(.up))
			let done = seconds == 0
			let urgent = !done && seconds <= urgentBelow
			// The number swells at the start of each of the last seconds.
			let beat = urgent ? 1 + 0.35 * pow(max(0, left / 1000 - Double(seconds - 1)), 3) : 1
			GeometryReader { geo in
				let size = min(geo.size.width, geo.size.height)
				ZStack {
					Circle().fill(
						RadialGradient(
							colors: [Color(red: 10 / 255, green: 20 / 255, blue: 42 / 255).opacity(0.9), Color(red: 10 / 255, green: 20 / 255, blue: 42 / 255).opacity(0.4)],
							center: .center, startRadius: size * 0.27, endRadius: size * 0.36)
					)
					Circle().stroke(.white.opacity(0.12), lineWidth: size * 0.07).padding(size * 0.05)
					Circle()
						.trim(from: 0, to: left / total)
						.stroke(urgent ? Theme.red : Theme.gold, style: StrokeStyle(lineWidth: size * 0.07, lineCap: .round))
						.rotationEffect(.degrees(-90))
						.padding(size * 0.05)
						.shadow(color: (urgent ? Theme.red : Theme.gold).opacity(0.6), radius: 6)
					Text(seconds >= 60 ? String(format: "%d:%02d", seconds / 60, seconds % 60) : "\(seconds)")
						.font(.system(size: size * (seconds >= 60 ? 0.3 : 0.44), weight: .heavy))
						.monospacedDigit()
						.foregroundStyle(done ? Theme.ink3 : urgent ? Theme.urgent : Theme.ink)
						.scaleEffect(beat)
				}
				.frame(width: geo.size.width, height: geo.size.height)
			}
			.accessibilityElement()
			.accessibilityLabel("\(model.t.common("timeLeft")): \(seconds)")
		}
	}
}

/// The clue of a round: a photo, a text, or both (`Clue.svelte`). The photo is never cropped.
struct ClueView: View {
	@Environment(AppModel.self) private var model
	let clue: Clue

	var body: some View {
		let text = clue.text(model.lang)
		if let photo = clue.photo {
			if text.isEmpty {
				PhotoFrame(photo: photo)
			} else {
				// A portrait photo leaves more room for the text.
				let portrait = photo.height > photo.width * 1.05
				GeometryReader { geo in
					let gap = rem(1.2)
					let photoShare = portrait ? 1.15 / 2.15 : 1.9 / 2.9
					HStack(spacing: gap) {
						PhotoFrame(photo: photo).frame(width: (geo.size.width - gap) * photoShare)
						Text(text)
							.font(.rem(max(1.2, Self.textSize(text) * 0.62), .bold))
							.lineSpacing(rem(0.25))
							.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
							.padding(rem(1.6))
							.minimumScaleFactor(0.5)
							.background(.white.opacity(0.05), in: RoundedRectangle(cornerRadius: rem(1.4)))
					}
				}
			}
		} else {
			VStack(spacing: 0) {
				Text("“").font(.system(size: rem(6), weight: .bold, design: .serif)).foregroundStyle(Theme.gold).frame(height: rem(3.2))
				Text(text)
					.font(.rem(Self.textSize(text), .bold))
					.multilineTextAlignment(.center)
					.lineSpacing(rem(0.3))
					.minimumScaleFactor(0.5)
					.frame(maxWidth: rem(Self.textSize(text) * 15))
			}
			.frame(maxWidth: .infinity, maxHeight: .infinity)
		}
	}

	/// Font size in rem: short clues are big, long ones still fit.
	static func textSize(_ text: String) -> CGFloat {
		switch text.count {
		case ...40: 3.6
		case ...80: 3
		case ...140: 2.5
		case ...240: 2.05
		case ...400: 1.7
		default: 1.4
		}
	}
}

/// A clue photo, whole, over a blurred copy of itself that fills the frame.
struct PhotoFrame: View {
	@Environment(AppModel.self) private var model
	let photo: CluePhoto

	var body: some View {
		ZStack {
			Color(hex: "#050a14")
			AsyncImage(url: model.mediaURL(photo.urls.sm)) { image in
				image.resizable().aspectRatio(contentMode: .fill)
			} placeholder: {
				Color.clear
			}
			.frame(minWidth: 0, maxWidth: .infinity, minHeight: 0, maxHeight: .infinity)
			.blur(radius: 36)
			.brightness(-0.35)
			.saturation(1.3)
			.clipped()

			AsyncImage(url: model.mediaURL(photo.urls.lg), transaction: Transaction(animation: .easeOut(duration: 0.7))) { phase in
				switch phase {
				case .success(let image):
					image.resizable().aspectRatio(contentMode: .fit)
				case .failure:
					VStack(spacing: rem(0.6)) {
						Image(systemName: "photo").font(.rem(3))
						Text(model.t.tv("photoMissing")).font(.rem(1.2))
					}
					.foregroundStyle(Theme.ink3)
				default:
					Color.clear
				}
			}
		}
		.clipShape(RoundedRectangle(cornerRadius: rem(1.4)))
	}
}

/// Who is guessing and who has locked in (`PlayersBar.svelte`).
struct PlayersBar: View {
	@Environment(AppModel.self) private var model
	let players: [Player]
	let lockedIds: [String]
	let eligibleIds: [String]
	let duel: Bool

	var body: some View {
		let t = model.t
		let eligible = players.filter { eligibleIds.contains($0.id) }
		let watching = players.filter { !eligibleIds.contains($0.id) }
		let locked = eligible.filter { lockedIds.contains($0.id) }.count
		let font: CGFloat =
			if duel { 1.6 } else {
				switch eligible.count {
				case ...8: 1.3
				case ...14: 1.05
				case ...24: 0.92
				default: 0.8
				}
			}
		HStack(spacing: rem(1.4)) {
			VStack(spacing: 0) {
				HStack(alignment: .firstTextBaseline, spacing: 0) {
					Text("\(locked)").font(.rem(2, .heavy)).contentTransition(.numericText())
					Text("/\(eligible.count)").font(.rem(1.3, .bold)).foregroundStyle(Theme.ink3)
				}
				Text(t.tv("lockedInCap").uppercased())
					.font(.rem(0.8, .bold))
					.tracking(rem(0.08))
					.foregroundStyle(Theme.ink3)
			}
			.animation(.easeOut(duration: 0.3), value: locked)

			FlowLayout(spacing: rem(0.5))  {
				ForEach(eligible) { player in
					chip(player, locked: lockedIds.contains(player.id), font: font)
				}
			}
			.frame(maxWidth: .infinity, alignment: .leading)
			.animation(.spring(duration: 0.4, bounce: 0.4), value: lockedIds)

			if !watching.isEmpty {
				VStack(alignment: .trailing, spacing: rem(0.2)) {
					Text(t.tv("watching").uppercased())
						.font(.rem(0.7, .bold))
						.tracking(rem(0.08))
						.foregroundStyle(Theme.ink3)
					HStack(spacing: rem(0.2)) {
						ForEach(watching.prefix(18)) { player in
							Avatar(nickname: player.nickname, color: player.color, size: rem(1.5), offline: !player.connected)
						}
						if watching.count > 18 {
							Text("+\(watching.count - 18)").font(.rem(0.8, .bold)).foregroundStyle(Theme.ink3)
						}
					}
				}
				.opacity(0.75)
			}
		}
		.padding(.horizontal, rem(1.1))
		.padding(.vertical, rem(0.7))
		.glass()
	}

	private func chip(_ player: Player, locked: Bool, font: CGFloat) -> some View {
		HStack(spacing: rem(font * 0.4)) {
			Avatar(nickname: player.nickname, color: player.color, size: rem(font * 1.75), offline: !player.connected)
				.overlay(alignment: .bottomTrailing) {
					if locked || !player.connected {
						Image(systemName: locked ? "checkmark" : "xmark")
							.font(.system(size: rem(font * 0.5), weight: .black))
							.foregroundStyle(locked ? Color(hex: "#06210f") : .white)
							.padding(rem(font * 0.15))
							.background(locked ? Theme.green : Theme.offlineGrey, in: Circle())
							.offset(x: rem(font * 0.25), y: rem(font * 0.2))
					}
				}
			Text(player.nickname)
				.font(.rem(font, .bold))
				.strikethrough(!player.connected && !locked)
				.lineLimit(1)
				.frame(maxWidth: rem(font * 9), alignment: .leading)
				.fixedSize()
		}
		.padding(.vertical, rem(font * 0.2))
		.padding(.leading, rem(font * 0.25))
		.padding(.trailing, rem(font * 0.8))
		.background(locked ? Theme.green.opacity(0.14) : .white.opacity(0.06), in: Capsule())
		.overlay(
			Capsule().stroke(
				locked ? Theme.green.opacity(0.55) : .white.opacity(player.connected ? 0 : 0.25),
				style: StrokeStyle(lineWidth: 1.5, dash: locked || player.connected ? [] : [5, 4]))
		)
		.opacity(locked ? 1 : player.connected ? 0.72 : 0.45)
		.scaleEffect(locked ? 1 : 0.97)
		.accessibilityLabel(player.connected ? player.nickname : "\(player.nickname) (\(model.t.tv("disconnected")))")
	}
}
