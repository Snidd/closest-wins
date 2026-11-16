import SwiftUI

/// The TV palette and sizes of the web big screen (`src/routes/tv/+page.svelte`, `--tv-*`).
enum Theme {
	/// The web TV's root font size at 1080p. Sizes copied from the Svelte screens are in rem.
	static let rem: CGFloat = 27
	/// 1 % of the screen width and height (tvOS lays out on 1920 × 1080 points).
	static let vw: CGFloat = 19.2
	static let vh: CGFloat = 10.8

	static let bg0 = Color(hex: "#040914")
	static let bg1 = Color(hex: "#0a1630")
	static let bg2 = Color(hex: "#13265a")
	static let ink = Color(hex: "#f4f7fc")
	static let ink2 = Color(hex: "#c0cbe0")
	static let ink3 = Color(hex: "#8593b0")
	static let gold = Color(hex: "#ffc23d")
	static let gold2 = Color(hex: "#ff9f1c")
	/// Text on gold.
	static let onGold = Color(hex: "#1d1400")
	static let red = Color(hex: "#ff4d5e")
	static let urgent = Color(hex: "#ff7380")
	static let green = Color(hex: "#3ddc84")
	static let offlineGrey = Color(hex: "#6b778c")
	static let line = Color.white.opacity(0.11)
	static let glass = Color(red: 14 / 255, green: 26 / 255, blue: 52 / 255).opacity(0.78)
	static let panel = Color(red: 10 / 255, green: 20 / 255, blue: 42 / 255).opacity(0.94)
}

func rem(_ value: CGFloat) -> CGFloat { value * Theme.rem }

extension Font {
	/// The system font at a size in rem.
	static func rem(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
		.system(size: size * Theme.rem, weight: weight)
	}
}

extension Color {
	/// `#rrggbb`.
	init(hex: String) {
		let (r, g, b) = Color.components(hex)
		self.init(red: r, green: g, blue: b)
	}

	/// `hex` mixed with white, keeping `keep` (0...1) of the colour: the web's
	/// `color-mix(in srgb, <colour> 55%, white)` for names written in a player's colour.
	init(hex: String, keep: Double) {
		let (r, g, b) = Color.components(hex)
		self.init(red: r * keep + (1 - keep), green: g * keep + (1 - keep), blue: b * keep + (1 - keep))
	}

	private static func components(_ hex: String) -> (Double, Double, Double) {
		let n = UInt32(hex.dropFirst(), radix: 16) ?? 0
		return (Double((n >> 16) & 255) / 255, Double((n >> 8) & 255) / 255, Double(n & 255) / 255)
	}
}

/// Small uppercase label above a heading.
struct Eyebrow: View {
	let text: String
	var color: Color = Theme.gold
	var size: CGFloat = 1

	var body: some View {
		Text(text.uppercased())
			.font(.rem(size, .heavy))
			.tracking(size * Theme.rem * 0.2)
			.foregroundStyle(color)
	}
}

/// A button in the TV palette: gold while the remote is on it.
struct TvButtonStyle: ButtonStyle {
	func makeBody(configuration: Configuration) -> some View {
		Label(configuration: configuration)
	}

	private struct Label: View {
		@Environment(\.isFocused) private var focused
		@Environment(\.isEnabled) private var enabled
		let configuration: Configuration

		var body: some View {
			configuration.label
				.foregroundStyle(focused ? Theme.onGold : Theme.ink)
				.padding(.horizontal, rem(1.2))
				.padding(.vertical, rem(0.5))
				.background(focused ? AnyShapeStyle(Theme.gold) : AnyShapeStyle(.white.opacity(0.1)), in: Capsule())
				.scaleEffect(focused ? 1.06 : 1)
				.opacity(enabled ? (configuration.isPressed ? 0.8 : 1) : 0.4)
				.animation(.easeOut(duration: 0.15), value: focused)
		}
	}
}

extension View {
	/// The translucent rounded panel used for bars and cards.
	func glass(radius: CGFloat = 1.3) -> some View {
		background(Theme.glass, in: RoundedRectangle(cornerRadius: rem(radius)))
			.overlay(RoundedRectangle(cornerRadius: rem(radius)).stroke(Theme.line, lineWidth: 1))
	}
}
