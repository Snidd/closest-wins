import ClosestWinsCore
import SwiftUI

/// The code the host types to put a game on this screen (`PairingScreen.svelte`). `code` is
/// nil while the screen is registering. The server changes the code every 10 minutes; a new
/// one just arrives as a new state.
struct PairingScreen: View {
	@Environment(AppModel.self) private var model
	let code: String?

	var body: some View {
		let t = model.t
		VStack(spacing: 0) {
			VStack(spacing: rem(0.5)) {
				Logo(size: 3.6)
				Text(t.common("tagline")).font(.rem(1.15, .medium)).foregroundStyle(Theme.ink2)
			}
			.padding(.top, 6 * Theme.vh)

			Spacer()

			VStack(spacing: 3.2 * Theme.vh) {
				Eyebrow(text: t.tv("pairingTitle"), size: 1.05)
				tiles
					.accessibilityElement()
					.accessibilityLabel(code.map { "\(t.tv("pairingCodeLabel")): \($0.map(String.init).joined(separator: " "))" } ?? t.tv("registering"))
				if code != nil {
					HStack(spacing: rem(0.5)) {
						Text(t.tv("pairingOpen"))
						Text("\(model.serverHost)/host")
							.fontWeight(.heavy)
							.foregroundStyle(Theme.ink)
							.padding(.horizontal, rem(0.6))
							.padding(.vertical, rem(0.1))
							.background(.white.opacity(0.1), in: RoundedRectangle(cornerRadius: rem(0.6)))
						Text(t.tv("pairingEnter"))
					}
					.font(.rem(1.55, .medium))
					.foregroundStyle(Theme.ink2)
					Text(t.tv("pairingRotates")).font(.rem(0.95)).foregroundStyle(Theme.ink3)
				} else {
					Text(t.tv("registering")).font(.rem(1.55, .medium)).foregroundStyle(Theme.ink3)
				}
			}

			Spacer()

			Button {
				model.forgetServer()
			} label: {
				Text("\(SetupStrings.of(model.lang).changeServer) · \(model.serverHost)").font(.rem(0.8))
			}
			.buttonStyle(TvButtonStyle())
			.opacity(0.8)
			// Above the "reconnecting" pill.
			.padding(.bottom, 9 * Theme.vh)
		}
	}

	private var tiles: some View {
		let length = model.shared.pairing.codeLength
		let digits = code.map { Array($0) } ?? []
		let size = min(10.5 * Theme.vw, 21 * Theme.vh)
		return HStack(spacing: min(1.2 * Theme.vw, 2 * Theme.vh)) {
			ForEach(0..<length, id: \.self) { i in
				Text(i < digits.count ? String(digits[i]) : " ")
					.font(.system(size: size, weight: .heavy))
					.monospacedDigit()
					.frame(width: size * 0.78, height: size * 1.08)
					.background(
						LinearGradient(colors: [.white.opacity(0.11), .white.opacity(0.04)], startPoint: .top, endPoint: .bottom),
						in: RoundedRectangle(cornerRadius: size * 0.14)
					)
					.overlay(RoundedRectangle(cornerRadius: size * 0.14).stroke(.white.opacity(0.14), lineWidth: 1))
					.opacity(code == nil ? 0.5 : 1)
					.padding(.leading, i == length / 2 ? size * 0.22 : 0)
			}
		}
	}
}
