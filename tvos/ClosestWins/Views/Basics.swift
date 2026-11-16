import ClosestWinsCore
import CoreImage.CIFilterBuiltins
import SwiftUI

/// The dark blue background behind every screen; red for sudden death, warm for the final.
struct Backdrop: View {
	enum Tone { case normal, danger, gold }
	let tone: Tone

	var body: some View {
		ZStack {
			LinearGradient(colors: [bg1, bg0], startPoint: .topLeading, endPoint: .bottomTrailing)
			RadialGradient(colors: [bg2, bg2.opacity(0)], center: UnitPoint(x: 0.5, y: 1.1), startRadius: 0, endRadius: 1100)
			RadialGradient(colors: [glowA, glowA.opacity(0)], center: UnitPoint(x: 0.12, y: 0.1), startRadius: 0, endRadius: 800)
			RadialGradient(colors: [glowB, glowB.opacity(0)], center: UnitPoint(x: 0.9, y: 0.75), startRadius: 0, endRadius: 700)
		}
		.animation(.easeInOut(duration: 0.8), value: tone)
	}

	private var bg0: Color { tone == .danger ? Color(hex: "#0d0410") : Theme.bg0 }
	private var bg1: Color { tone == .danger ? Color(hex: "#2a0a1c") : Theme.bg1 }
	private var bg2: Color { tone == .danger ? Color(hex: "#5a1230") : Theme.bg2 }
	private var glowA: Color {
		switch tone {
		case .normal: Color(red: 46 / 255, green: 112 / 255, blue: 1).opacity(0.35)
		case .danger: Color(red: 1, green: 40 / 255, blue: 70 / 255).opacity(0.45)
		case .gold: Color(red: 1, green: 190 / 255, blue: 60 / 255).opacity(0.35)
		}
	}
	private var glowB: Color {
		switch tone {
		case .normal: Color(red: 0, green: 200 / 255, blue: 220 / 255).opacity(0.22)
		case .danger: Color(red: 140 / 255, green: 20 / 255, blue: 60 / 255).opacity(0.6)
		case .gold: Color(red: 1, green: 120 / 255, blue: 40 / 255).opacity(0.3)
		}
	}
}

/// The target-and-pin mark, with the app name beside it unless `wordmark` is off.
struct Logo: View {
	@Environment(AppModel.self) private var model
	/// Font size in rem; the mark is 1.25 × that.
	var size: CGFloat = 1.6
	var wordmark = true
	var color: Color = Theme.ink

	var body: some View {
		HStack(spacing: rem(size * 0.35)) {
			mark.frame(width: rem(size * 1.25), height: rem(size * 1.25))
			if wordmark {
				Text(model.t.common("appName")).font(.rem(size, .heavy)).foregroundStyle(color)
			}
		}
	}

	private var mark: some View {
		Canvas { context, canvas in
			let s = canvas.width / 48
			let gold = GraphicsContext.Shading.linearGradient(
				Gradient(colors: [Color(hex: "#ffd76a"), Theme.gold2]),
				startPoint: .zero, endPoint: CGPoint(x: canvas.width, y: canvas.height)
			)
			func ring(_ r: CGFloat) -> Path {
				Path(ellipseIn: CGRect(x: (24 - r) * s, y: (26 - r) * s, width: 2 * r * s, height: 2 * r * s))
			}
			context.stroke(ring(19), with: gold, lineWidth: 3.5 * s)
			context.opacity = 0.75
			context.stroke(ring(11), with: gold, lineWidth: 3.5 * s)
			context.opacity = 1
			// The pin: a drop with its tip on the bullseye.
			var pin = Path()
			pin.move(to: CGPoint(x: 24 * s, y: 27 * s))
			pin.addCurve(
				to: CGPoint(x: 24 * s, y: 3 * s),
				control1: CGPoint(x: 10 * s, y: 14 * s), control2: CGPoint(x: 14 * s, y: 3 * s))
			pin.addCurve(
				to: CGPoint(x: 24 * s, y: 27 * s),
				control1: CGPoint(x: 34 * s, y: 3 * s), control2: CGPoint(x: 38 * s, y: 14 * s))
			context.fill(pin, with: .color(Theme.red))
			context.stroke(pin, with: .color(Color(hex: "#0a1328")), lineWidth: 1.5 * s)
			context.fill(Path(ellipseIn: CGRect(x: 20.4 * s, y: 8.4 * s, width: 7.2 * s, height: 7.2 * s)), with: .color(.white))
		}
	}
}

/// A player's disc with their initial.
struct Avatar: View {
	@Environment(AppModel.self) private var model
	let nickname: String
	/// `#rrggbb`.
	let color: String
	/// Diameter in points.
	let size: CGFloat
	var ring = false
	var offline = false

	var body: some View {
		Circle()
			.fill(Color(hex: color))
			.overlay(
				RadialGradient(
					colors: [.white.opacity(0.38), .white.opacity(0)],
					center: UnitPoint(x: 0.32, y: 0.28), startRadius: 0, endRadius: size * 0.6
				).clipShape(Circle())
			)
			.overlay(
				Text(initial)
					.font(.system(size: size * 0.5, weight: .heavy))
					.foregroundStyle(Color(hex: model.shared.textColor(on: color)))
			)
			.frame(width: size, height: size)
			.padding(ring ? size * 0.07 : 0)
			.overlay(ring ? Circle().stroke(Color(hex: color), lineWidth: size * 0.13).padding(-size * 0.065) : nil)
			.padding(ring ? size * 0.13 : 0)
			.saturation(offline ? 0 : 1)
			.opacity(offline ? 0.5 : 1)
	}

	private var initial: String {
		nickname.trimmingCharacters(in: .whitespaces).first.map { String($0).uppercased() } ?? "?"
	}
}

/// A QR code, black on a white plate with a quiet zone of two modules.
struct QrCode: View {
	let value: String

	var body: some View {
		if let image = Self.image(value) {
			Image(uiImage: image)
				.interpolation(.none)
				.resizable()
				.aspectRatio(1, contentMode: .fit)
		} else {
			Color.white.aspectRatio(1, contentMode: .fit)
		}
	}

	private static func image(_ value: String) -> UIImage? {
		let filter = CIFilter.qrCodeGenerator()
		filter.message = Data(value.utf8)
		filter.correctionLevel = "M"
		guard let output = filter.outputImage else { return nil }
		// Core Image adds one module of margin; the web TV uses two.
		let padded = output.extent.insetBy(dx: -1, dy: -1)
		let plate = CIImage(color: .white).cropped(to: padded)
		guard let cg = CIContext().createCGImage(output.composited(over: plate), from: padded) else { return nil }
		return UIImage(cgImage: cg)
	}
}

/// The corner badge during a game: where to join and the code.
struct JoinBug: View {
	@Environment(AppModel.self) private var model
	let game: GameInfo

	var body: some View {
		HStack(spacing: rem(0.7)) {
			Logo(size: 1.5, wordmark: false)
			VStack(alignment: .leading, spacing: 0) {
				Text(model.t.tv("join").uppercased())
					.font(.rem(0.8, .bold))
					.tracking(rem(0.1))
					.foregroundStyle(Theme.ink2)
				Text(shortJoinUrl(game.joinUrl)).font(.rem(0.95, .semibold))
			}
			Text(game.joinCode)
				.font(.system(size: rem(1.6), weight: .black, design: .monospaced))
				.tracking(rem(0.13))
				.foregroundStyle(Theme.onGold)
				.padding(.horizontal, rem(0.55))
				.padding(.vertical, rem(0.1))
				.background(Theme.gold, in: RoundedRectangle(cornerRadius: rem(0.4)))
		}
		.padding(.horizontal, rem(0.9))
		.padding(.vertical, rem(0.5))
		.glass(radius: 2.5)
	}
}

/// `http://x.y:5173/join/ABCD` → `x.y:5173/join`: what people type before the code.
func shortJoinUrl(_ joinUrl: String) -> String {
	guard let url = URL(string: joinUrl), let host = url.host() else { return joinUrl }
	let origin = url.port.map { "\(host):\($0)" } ?? host
	let path = url.deletingLastPathComponent().path().trimmingCharacters(in: CharacterSet(charactersIn: "/"))
	return path.isEmpty ? origin : "\(origin)/\(path)"
}

/// Lays children out left to right and wraps to new lines, each line centred or leading.
struct FlowLayout: Layout {
	var spacing: CGFloat = 8
	var centered = false

	func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
		let rows = rows(width: proposal.width ?? .infinity, subviews)
		return CGSize(
			width: proposal.width ?? rows.map(\.width).max() ?? 0,
			height: rows.map(\.height).reduce(0, +) + spacing * CGFloat(max(0, rows.count - 1))
		)
	}

	func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
		var y = bounds.minY
		for row in rows(width: bounds.width, subviews) {
			var x = bounds.minX + (centered ? (bounds.width - row.width) / 2 : 0)
			for index in row.indices {
				let size = subviews[index].sizeThatFits(.unspecified)
				subviews[index].place(at: CGPoint(x: x, y: y + (row.height - size.height) / 2), proposal: .unspecified)
				x += size.width + spacing
			}
			y += row.height + spacing
		}
	}

	private struct Row {
		var indices: [Int] = []
		var width: CGFloat = 0
		var height: CGFloat = 0
	}

	private func rows(width: CGFloat, _ subviews: Subviews) -> [Row] {
		var rows = [Row()]
		for (index, subview) in subviews.enumerated() {
			let size = subview.sizeThatFits(.unspecified)
			let needed = rows[rows.count - 1].indices.isEmpty ? size.width : rows[rows.count - 1].width + spacing + size.width
			if needed > width, !rows[rows.count - 1].indices.isEmpty {
				rows.append(Row(indices: [index], width: size.width, height: size.height))
			} else {
				rows[rows.count - 1].indices.append(index)
				rows[rows.count - 1].width = needed
				rows[rows.count - 1].height = max(rows[rows.count - 1].height, size.height)
			}
		}
		return rows
	}
}

/// A small crown, drawn over winners.
struct Crown: View {
	var size: CGFloat

	var body: some View {
		Image(systemName: "crown.fill")
			.font(.system(size: size))
			.foregroundStyle(Theme.gold)
			.shadow(color: .black.opacity(0.4), radius: 2, y: 1)
	}
}
