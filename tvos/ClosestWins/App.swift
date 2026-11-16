import ClosestWinsCore
import SwiftUI

@main
struct ClosestWinsApp: App {
	@State private var model = AppModel()

	var body: some Scene {
		WindowGroup {
			RootView()
				.environment(model)
				.preferredColorScheme(.dark)
				.onAppear {
					// The big screen is watched, not touched: never start the screensaver.
					UIApplication.shared.isIdleTimerDisabled = true
				}
		}
	}
}

/// Picks the screen for the current state, like the web shell (`src/routes/tv/+page.svelte`).
struct RootView: View {
	@Environment(AppModel.self) private var model

	var body: some View {
		ZStack {
			Backdrop(tone: tone)
			screen
				.id(screenKey)
				.transition(.opacity)
			if model.offline && model.server != nil {
				OfflinePill(text: model.t.tv("reconnecting"))
					.frame(maxHeight: .infinity, alignment: .bottom)
					.padding(.bottom, rem(1.2))
					.transition(.opacity)
			}
		}
		// A fixed size, not "as large as possible": with a flexible frame some screens
		// (sudden-death standings, the final) were laid out shorter than the screen.
		.frame(width: 100 * Theme.vw, height: 100 * Theme.vh)
		.ignoresSafeArea()
		.foregroundStyle(Theme.ink)
		.animation(.easeOut(duration: 0.55), value: screenKey)
		.animation(.easeOut(duration: 0.3), value: model.offline)
	}

	@ViewBuilder private var screen: some View {
		if model.server == nil {
			SetupScreen()
		} else {
			switch model.state {
			case nil, .unregistered:
				PairingScreen(code: nil)
			case .pairing(_, let pairing):
				PairingScreen(code: pairing.pairingCode)
			case .paired(let snap):
				switch snap.phase {
				case .lobby:
					LobbyScreen(snap: snap)
				case .round(let round, let locked):
					RoundScreen(snap: snap, round: round, lockedPlayerIds: locked)
				case .reveal(let result, _):
					RevealScreen(snap: snap, result: result, model: model)
				case .standings(let result, let standings, let next):
					StandingsScreen(snap: snap, result: result, standings: standings, next: next)
				case .finished(let standings, let winners, let endedEarly):
					FinishedScreen(snap: snap, standings: standings, winnerPlayerIds: winners, endedEarly: endedEarly)
				}
			}
		}
	}

	/// Changes when the screen should cross-fade: per round, not per snapshot.
	private var screenKey: String {
		guard model.server != nil else { return "setup" }
		guard let snap = model.state?.snapshot else { return "pairing" }
		switch snap.phase {
		case .lobby: return "lobby-\(snap.game.id)"
		case .round(let round, _): return "round-\(round.index)"
		case .reveal(let result, _): return "reveal-\(result.round.index)"
		case .standings(let result, _, _): return "standings-\(result.round.index)"
		case .finished: return "finished-\(snap.game.id)"
		}
	}

	private var tone: Backdrop.Tone {
		switch model.state?.snapshot?.phase {
		case .round(let round, _) where round.isSuddenDeath: .danger
		case .standings(_, _, .suddenDeath): .danger
		case .finished: .gold
		default: .normal
		}
	}
}

struct OfflinePill: View {
	let text: String
	@State private var pulse = false

	var body: some View {
		HStack(spacing: rem(0.5)) {
			Circle()
				.fill(Theme.red)
				.frame(width: rem(0.6), height: rem(0.6))
				.opacity(pulse ? 0.3 : 1)
			Text(text).font(.rem(0.95, .bold))
		}
		.foregroundStyle(Color(hex: "#ffd0d5"))
		.padding(.horizontal, rem(1))
		.padding(.vertical, rem(0.45))
		.background(Color(red: 30 / 255, green: 10 / 255, blue: 16 / 255).opacity(0.85), in: Capsule())
		.overlay(Capsule().stroke(Color(red: 1, green: 90 / 255, blue: 103 / 255).opacity(0.5), lineWidth: 1))
		.onAppear {
			withAnimation(.easeInOut(duration: 0.6).repeatForever()) { pulse = true }
		}
	}
}
