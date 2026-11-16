import ClosestWinsCore
import MapKit
import SwiftUI

/// The map of the reveal (`src/lib/map/RevealMap.svelte`): the guesses appear as pins one by
/// one, then the target, then lines growing from each guess to it while its distance counts up. MapKit instead of the web's own tiles, so
/// the map looks different and needs the internet.
struct RevealMap: View {
	@Environment(AppModel.self) private var model
	let result: RoundResult
	let players: [Player]
	let stage: RevealStage
	/// Screen areas covered by the panels: the camera frames within what is left.
	let insets: EdgeInsets

	var body: some View {
		// Redrawn every frame while something moves: pins arriving, the camera flight, the lines.
		TimelineView(.animation(paused: stage == .done)) { context in
			let timing = self.timing(at: context.date)
			let rect = camera(timing)
			let drawn = lineProgress(timing)
			ZStack {
				map(
					camera: rect, lineProgress: drawn,
					// In `pins` each guess waits for its turn; after that all are on the map.
					shownUntil: stage == .pins ? model.clock.now(context.date) : .infinity)
				if drawn > 0 {
					lines(camera: rect, progress: drawn)
				}
			}
		}
	}

	private func timing(at date: Date) -> RevealTiming {
		let reveal = model.shared.reveal
		return RevealTiming(result, now: model.clock.now(date), flyMs: reveal.flyMs, linesMs: reveal.linesMs)
	}

	/// Where the camera is: on the pins, on its way (the whole `flying` stage, however late the
	/// screen appeared), or on the answer. Set frame by frame, because MapKit's own camera
	/// animation ignores the duration it is given.
	private func camera(_ timing: RevealTiming) -> MKMapRect {
		let camera = RevealCamera(insets: insets)
		switch stage {
		case .pins: return camera.pins(result)
		case .lines, .done: return camera.answer(result)
		case .flying:
			let x = timing.stage > .flying ? 1 : timing.progress
			// Ease in and out.
			let eased = x < 0.5 ? 4 * x * x * x : 1 - pow(-2 * x + 2, 3) / 2
			return RevealCamera.between(camera.pins(result), camera.answer(result), eased)
		}
	}

	/// How much of each line is drawn: 0 before `lines`, eased while it runs, 1 after.
	private func lineProgress(_ timing: RevealTiming) -> Double {
		if stage < .lines { return 0 }
		if stage > .lines { return 1 }
		let x = timing.stage > .lines ? 1 : timing.stage < .lines ? 0 : timing.progress
		return 1 - pow(1 - x, 3)
	}

	private func map(camera: MKMapRect, lineProgress: Double, shownUntil: EpochMs) -> some View {
		let target = GeoPoint(lat: result.target.lat, lng: result.target.lng)
		// Winners last, so their pins and lines lie on top.
		let guesses = result.guesses.filter { $0.revealAt <= shownUntil }.sorted { !$0.isWinner && $1.isWinner }
		return Map(position: .constant(.rect(camera)), interactionModes: []) {
			if stage >= .flying {
				Annotation("", coordinate: CLLocationCoordinate2D(latitude: target.lat, longitude: target.lng)) {
					TargetMarker()
				}
			}
			ForEach(guesses, id: \.playerId) { guess in
				Annotation(
					"",
					coordinate: CLLocationCoordinate2D(latitude: guess.lat, longitude: RevealGeometry.normalizeLng(guess.lng))
				) {
					GuessPin(
						name: players.first { $0.id == guess.playerId }?.nickname ?? "",
						color: color(of: guess),
						// Counts up as the line grows, and lands on the real distance with it.
						distance: stage >= .lines ? model.t.km(guess.distanceKm * lineProgress) : nil,
						// The label goes on the side away from the target, clear of the line.
						labelAbove: guess.lat > target.lat,
						winner: stage == .done && guess.isWinner,
						dimmed: stage == .done && !guess.isWinner)
				}
			}
		}
		.mapStyle(.standard(elevation: .flat, emphasis: .muted, pointsOfInterest: .excludingAll))
		.environment(\.colorScheme, .dark)
		// Disabled, so it never takes focus: the remote must not pan the map, and tvOS must not
		// offer its map options ("Press play/pause for options").
		.disabled(true)
	}

	/// The lines from each guess to the target, drawn over the map by our own projection of the
	/// camera rect. MapKit's polylines cannot do this: replaced every frame they are not drawn
	/// until the growing stops. The pins' dots and the bullseye are drawn again on top, so each
	/// line starts and ends underneath them.
	private func lines(camera: MKMapRect, progress: Double) -> some View {
		let target = GeoPoint(lat: result.target.lat, lng: result.target.lng)
		let guesses = result.guesses.sorted { !$0.isWinner && $1.isWinner }
		let done = stage == .done
		return Canvas { context, size in
			let projection = RevealProjection(camera: camera, anchorLng: target.lng, size: size)
			for guess in guesses {
				let points = RevealGeometry.slicePath(
					RevealGeometry.guessPath(from: GeoPoint(lat: guess.lat, lng: guess.lng), to: target),
					fraction: progress
				).map(projection.point)
				var line = Path()
				line.addLines(points)
				let round = StrokeStyle(lineWidth: guess.isWinner ? 7 : 4.5, lineCap: .round, lineJoin: .round)
				context.stroke(line, with: .color(Color(hex: "#06121f").opacity(guess.isWinner ? 0.9 : 0.55)), style: round)
				context.stroke(
					line, with: .color(Color(hex: color(of: guess)).opacity(guess.isWinner ? 1 : 0.8)),
					style: StrokeStyle(lineWidth: guess.isWinner ? 4 : 2.5, lineCap: .round, lineJoin: .round))
			}
			func disc(_ centre: CGPoint, _ diameter: CGFloat) -> Path {
				Path(ellipseIn: CGRect(x: centre.x - diameter / 2, y: centre.y - diameter / 2, width: diameter, height: diameter))
			}
			let bullseye = projection.point(target)
			context.fill(disc(bullseye, TargetMarker.size), with: .color(.white))
			context.fill(disc(bullseye, TargetMarker.size * 0.62), with: .color(TargetMarker.red))
			context.fill(disc(bullseye, TargetMarker.size * 0.3), with: .color(.white))
			for guess in guesses {
				let winner = done && guess.isWinner
				let dot = disc(projection.point(GeoPoint(lat: guess.lat, lng: guess.lng)), GuessPin.dotSize(winner: winner))
				context.opacity = done && !guess.isWinner ? 0.8 : 1
				context.fill(dot, with: .color(Color(hex: color(of: guess))))
				context.stroke(dot, with: .color(winner ? Theme.gold : .white), lineWidth: rem(0.17))
			}
		}
		.allowsHitTesting(false)
	}

	private func color(of guess: RevealGuess) -> String {
		players.first { $0.id == guess.playerId }?.color ?? "#ffffff"
	}
}

/// Where a place is on screen when the map shows `camera` (Web Mercator: both axes are linear
/// in map points). Longitudes may lie beyond ±180, as in the paths of `RevealGeometry`: they
/// are placed relative to `anchorLng`, which is taken to be the copy of the world on screen.
struct RevealProjection {
	let camera: MKMapRect
	let size: CGSize
	/// Map x of longitude 0 in the world copy the camera shows.
	private let originX: Double

	init(camera: MKMapRect, anchorLng: Double, size: CGSize) {
		self.camera = camera
		self.size = size
		let world = MKMapSize.world.width
		let anchorX = (RevealGeometry.normalizeLng(anchorLng) + 180) / 360 * world
		// The anchor's copy nearest the middle of the camera.
		let turns = ((camera.midX - anchorX) / world).rounded()
		originX = turns * world - (anchorLng - RevealGeometry.normalizeLng(anchorLng)) / 360 * world
	}

	func point(_ place: GeoPoint) -> CGPoint {
		let world = MKMapSize.world.width
		let x = (place.lng + 180) / 360 * world + originX
		let y = MKMapPoint(CLLocationCoordinate2D(latitude: place.lat, longitude: 0)).y
		return CGPoint(
			x: (x - camera.minX) / camera.width * size.width,
			y: (y - camera.minY) / camera.height * size.height)
	}
}

/// Turns the bounds from `RevealGeometry` into what the map shows, leaving room for the panels.
struct RevealCamera {
	let insets: EdgeInsets
	private let screen = CGSize(width: 100 * Theme.vw, height: 100 * Theme.vh)

	/// The web caps the zoom (MapLibre zoom 4 for the pins, 7 for the answer). The same as the
	/// least longitude the full screen width may show: 360° × width / (512 × 2^zoom).
	private func minLngSpan(maxZoom: Double) -> Double {
		360 * screen.width / (512 * pow(2, maxZoom))
	}

	/// Suspense view: all guesses, never depending on the target.
	func pins(_ result: RoundResult) -> MKMapRect {
		let bounds = RevealGeometry.guessesBounds(result.guesses.map { GeoPoint(lat: $0.lat, lng: $0.lng) })
		return rect(bounds, minLngSpan: minLngSpan(maxZoom: 4))
	}

	/// Answer view: the target and the closest guesses.
	func answer(_ result: RoundResult) -> MKMapRect {
		let bounds = RevealGeometry.answerBounds(
			target: GeoPoint(lat: result.target.lat, lng: result.target.lng), guesses: result.guesses)
		return rect(bounds, minLngSpan: minLngSpan(maxZoom: 7))
	}

	/// The camera a fraction `t` (0...1) of the way from `a` to `b`. The zoom changes evenly
	/// (the size shrinks by the same factor each step) and the centre moves with it, so the
	/// place being flown to drifts steadily towards its spot.
	static func between(_ a: MKMapRect, _ b: MKMapRect, _ t: Double) -> MKMapRect {
		let world = MKMapSize.world.width
		let width = a.width * pow(b.width / a.width, t)
		let height = a.height * pow(b.height / a.height, t)
		let moved = abs(a.width - b.width) > 1 ? (a.width - width) / (a.width - b.width) : t
		// The short way round the world.
		var dx = (b.midX - a.midX).truncatingRemainder(dividingBy: world)
		if dx > world / 2 { dx -= world } else if dx < -world / 2 { dx += world }
		var x = a.midX + dx * moved - width / 2
		x = (x.truncatingRemainder(dividingBy: world) + world).truncatingRemainder(dividingBy: world)
		let y = a.midY + (b.midY - a.midY) * moved - height / 2
		return MKMapRect(x: x, y: y, width: width, height: height)
	}

	/// The map rect for the whole screen such that `bounds` fits the area between the panels.
	/// Without bounds (nobody guessed): the whole world.
	private func rect(_ bounds: GeoBounds?, minLngSpan: Double) -> MKMapRect {
		let world = MKMapSize.world
		guard let bounds else {
			let height = world.width * screen.height / screen.width
			let centre = MKMapPoint(CLLocationCoordinate2D(latitude: 25, longitude: 10))
			return MKMapRect(x: 0, y: centre.y - height / 2, width: world.width, height: height)
		}
		func y(_ lat: Double) -> Double { MKMapPoint(CLLocationCoordinate2D(latitude: lat, longitude: 0)).y }
		let free = CGSize(
			width: screen.width - insets.leading - insets.trailing,
			height: screen.height - insets.top - insets.bottom)
		// A margin around the framed points, like the web: 12 % of the shorter side plus 2 rem.
		let margin = min(free.width, free.height) * 0.12 + rem(2)
		let boxWidth = bounds.lngSpan / 360 * world.width
		let boxHeight = y(bounds.south) - y(bounds.north)
		// Map points per screen point.
		var scale = max(
			boxWidth / (free.width - 2 * margin),
			boxHeight / (free.height - 2 * margin),
			minLngSpan / 360 * world.width / screen.width)
		scale = min(scale, world.width / screen.width)

		let centreX = MKMapPoint(CLLocationCoordinate2D(latitude: 0, longitude: RevealGeometry.normalizeLng(bounds.center.lng))).x
		let centreY = (y(bounds.north) + y(bounds.south)) / 2
		// Where the free area's centre lies relative to the screen's.
		let dx = insets.leading + free.width / 2 - screen.width / 2
		let dy = insets.top + free.height / 2 - screen.height / 2
		let size = MKMapSize(width: screen.width * scale, height: screen.height * scale)
		var x = centreX - dx * scale - size.width / 2
		// A rect may run past the antimeridian, but must start inside the world.
		x = (x.truncatingRemainder(dividingBy: world.width) + world.width).truncatingRemainder(dividingBy: world.width)
		let top = max(0, min(world.height - size.height, centreY - dy * scale - size.height / 2))
		return MKMapRect(origin: MKMapPoint(x: x, y: top), size: size)
	}
}

/// The answer: a bullseye that drops onto the map with a pulsing ring.
struct TargetMarker: View {
	static let size: CGFloat = 34
	static let red = Color(hex: "#ff5a67")
	@State private var landed = false
	@State private var pulse = false

	var body: some View {
		ZStack {
			Circle()
				.stroke(Theme.red, lineWidth: 3)
				.frame(width: Self.size, height: Self.size)
				.scaleEffect(pulse ? 2.4 : 1)
				.opacity(pulse ? 0 : 0.9)
			Circle().fill(.white).frame(width: Self.size, height: Self.size)
			Circle().fill(Self.red).frame(width: Self.size * 0.62, height: Self.size * 0.62)
			Circle().fill(.white).frame(width: 10, height: 10)
		}
		.shadow(color: .black.opacity(0.5), radius: 5, y: 2)
		.scaleEffect(landed ? 1 : 2.6)
		.opacity(landed ? 1 : 0)
		.onAppear {
			withAnimation(.spring(duration: 0.65, bounce: 0.45)) { landed = true }
			withAnimation(.easeOut(duration: 1.6).repeatForever(autoreverses: false).delay(0.65)) { pulse = true }
		}
	}
}

/// A guess: a dot in the player's colour with their name, and the distance once it is known.
struct GuessPin: View {
	/// Diameter of the dot; a round's winner gets a bigger one.
	static func dotSize(winner: Bool) -> CGFloat { rem(1.1) * (winner ? 1.35 : 1) }

	let name: String
	let color: String
	let distance: String?
	let labelAbove: Bool
	let winner: Bool
	let dimmed: Bool
	@State private var landed = false

	var body: some View {
		let dot = Self.dotSize(winner: winner)
		Circle()
			.fill(Color(hex: color))
			.overlay(Circle().stroke(winner ? Theme.gold : .white, lineWidth: rem(0.17)))
			.frame(width: dot, height: dot)
			.shadow(color: .black.opacity(0.5), radius: 3, y: 1)
			.overlay(alignment: labelAbove ? .bottom : .top) {
				HStack(spacing: rem(0.3)) {
					if winner { Crown(size: rem(0.7)) }
					Text(name).fontWeight(.bold)
					if let distance { Text(distance).monospacedDigit().opacity(0.8) }
				}
				.font(.rem(0.8))
				.foregroundStyle(winner ? Theme.onGold : Color(hex: "#e8eef6"))
				.lineLimit(1)
				.padding(.horizontal, rem(0.45))
				.padding(.vertical, rem(0.12))
				.background(
					winner ? AnyShapeStyle(Theme.gold) : AnyShapeStyle(Color(red: 12 / 255, green: 24 / 255, blue: 38 / 255).opacity(0.92)),
					in: RoundedRectangle(cornerRadius: rem(0.3))
				)
				.overlay(alignment: .leading) {
					if !winner {
						RoundedRectangle(cornerRadius: 2).fill(Color(hex: color)).frame(width: 4).padding(.vertical, 3)
					}
				}
				.fixedSize()
				.offset(y: (dot + rem(0.25)) * (labelAbove ? -1 : 1))
			}
			.opacity(dimmed ? 0.8 : 1)
			.animation(.easeOut(duration: 0.4), value: winner)
			// Pops onto the map when its turn comes.
			.scaleEffect(landed ? 1 : 0.2)
			.opacity(landed ? 1 : 0)
			.onAppear {
				withAnimation(.spring(duration: 0.42, bounce: 0.4)) { landed = true }
			}
	}
}
