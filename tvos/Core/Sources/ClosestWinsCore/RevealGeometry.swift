import Foundation

// What the reveal camera frames and the lines it draws: a port of `src/lib/map/reveal.ts` and
// the helpers it uses from `src/lib/map/geometry.ts`. The numbers (minimum spans 1.5° and 20°,
// rank ≤ 3, 3× the winner's distance, at least 600 km) are copied from there, not exported to
// `shared.json`: change them in both places.

public struct GeoPoint: Sendable, Equatable {
	public var lat: Double
	/// May lie beyond ±180 in a path that crosses the antimeridian.
	public var lng: Double

	public init(lat: Double, lng: Double) {
		self.lat = lat
		self.lng = lng
	}
}

/// A box in degrees. `east` exceeds 180 when the box crosses the antimeridian.
public struct GeoBounds: Sendable, Equatable {
	public var west: Double
	public var south: Double
	public var east: Double
	public var north: Double

	public var center: GeoPoint { GeoPoint(lat: (south + north) / 2, lng: (west + east) / 2) }
	public var latSpan: Double { north - south }
	public var lngSpan: Double { east - west }
}

public enum RevealGeometry {
	/// Answer view: each side spans at least this many degrees.
	public static let answerMinSpanDeg = 1.5
	/// Suspense view (all guesses): each side spans at least this many degrees.
	public static let guessesMinSpanDeg = 20.0
	/// Latitudes the camera frames (just inside what Web Mercator can show).
	static let cameraMaxLat = 85.0

	/// Wraps a longitude into [-180, 180].
	public static func normalizeLng(_ lng: Double) -> Double {
		if lng >= -180, lng <= 180 { return lng }
		let wrapped = (lng + 180).truncatingRemainder(dividingBy: 360)
		return (wrapped < 0 ? wrapped + 360 : wrapped) - 180
	}

	/// Shifts `lng` by whole turns so it lies within 180° of `ref`.
	public static func unwrapLng(_ lng: Double, ref: Double) -> Double {
		ref + normalizeLng(lng - ref)
	}

	/// Guesses the camera frames together with the target: the winners, plus the next closest
	/// (rank ≤ 3) as long as they are not much farther away than the winner, so one wild guess
	/// does not zoom the answer out to the whole world.
	public static func framedGuesses(_ guesses: [RevealGuess]) -> [RevealGuess] {
		let best = guesses.map(\.distanceKm).min() ?? .infinity
		let limit = max(best * 3, 600)
		return guesses.filter { $0.isWinner || ($0.rank <= 3 && $0.distanceKm <= limit) }
	}

	/// Great-circle path from a guess to the target, continuous and anchored at the target.
	public static func guessPath(from guess: GeoPoint, to target: GeoPoint) -> [GeoPoint] {
		greatCirclePath(GeoPoint(lat: guess.lat, lng: unwrapLng(guess.lng, ref: target.lng)), target)
	}

	/// Bounds the camera frames for the answer: the target, the framed guesses and their lines.
	public static func answerBounds(target: GeoPoint, guesses: [RevealGuess]) -> GeoBounds {
		var points = [target]
		for g in framedGuesses(guesses) {
			points += guessPath(from: GeoPoint(lat: g.lat, lng: g.lng), to: target)
		}
		let anchored = points.map { GeoPoint(lat: $0.lat, lng: unwrapLng($0.lng, ref: target.lng)) }
		return padBounds(boundsOf(anchored)!, minSpanDeg: answerMinSpanDeg)
	}

	/// Bounds of all guesses, for the suspense view. Never depends on the target.
	public static func guessesBounds(_ guesses: [GeoPoint]) -> GeoBounds? {
		boundsOf(guesses).map { padBounds($0, minSpanDeg: guessesMinSpanDeg) }
	}

	/// Points along the great circle from `a` to `b`, evenly spaced, as a continuous path: the
	/// first point keeps `a.lng` and later longitudes are unwrapped, so a line across the
	/// antimeridian goes beyond ±180 instead of jumping across the map.
	public static func greatCirclePath(_ a: GeoPoint, _ b: GeoPoint) -> [GeoPoint] {
		let rad = Double.pi / 180
		let d = centralAngle(a, b)
		if d < 1e-9 { return [a, GeoPoint(lat: b.lat, lng: unwrapLng(b.lng, ref: a.lng))] }
		let n = max(2, min(256, Int((d / rad / 1.5).rounded(.up))))
		let (lat1, lng1, lat2, lng2) = (a.lat * rad, a.lng * rad, b.lat * rad, b.lng * rad)
		let sinD = sin(d)
		var points: [GeoPoint] = []
		for i in 0...n {
			let f = Double(i) / Double(n)
			// Antipodal points have no unique great circle: blend linearly.
			let A = sinD < 1e-9 ? 1 - f : sin((1 - f) * d) / sinD
			let B = sinD < 1e-9 ? f : sin(f * d) / sinD
			let x = A * cos(lat1) * cos(lng1) + B * cos(lat2) * cos(lng2)
			let y = A * cos(lat1) * sin(lng1) + B * cos(lat2) * sin(lng2)
			let z = A * sin(lat1) + B * sin(lat2)
			points.append(GeoPoint(lat: atan2(z, (x * x + y * y).squareRoot()) / rad, lng: atan2(y, x) / rad))
		}
		points[0] = a
		points[n] = b
		for i in 1...n {
			points[i].lng = unwrapLng(points[i].lng, ref: points[i - 1].lng)
		}
		return points
	}

	/// The first `fraction` (0...1) of a path, interpolating the last point.
	public static func slicePath(_ path: [GeoPoint], fraction: Double) -> [GeoPoint] {
		if path.count < 2 || fraction >= 1 { return path }
		let f = max(0, fraction) * Double(path.count - 1)
		let i = Int(f)
		let t = f - Double(i)
		var out = Array(path[0...i])
		let a = path[i]
		if i + 1 < path.count, t > 0 {
			let b = path[i + 1]
			out.append(GeoPoint(lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t))
		}
		if out.count == 1 { out.append(a) }
		return out
	}

	/// Bounds of points, compact across the antimeridian.
	public static func boundsOf(_ points: [GeoPoint]) -> GeoBounds? {
		guard !points.isEmpty else { return nil }
		let (west, east) = lngExtent(points.map(\.lng))
		let lats = points.map(\.lat)
		return GeoBounds(west: west, south: lats.min()!, east: east, north: lats.max()!)
	}

	/// Grows bounds around their centre so each side spans at least `minSpanDeg`, then keeps the
	/// latitudes within what the map can show.
	public static func padBounds(_ bounds: GeoBounds, minSpanDeg: Double) -> GeoBounds {
		var b = bounds
		if b.east - b.west < minSpanDeg {
			let c = (b.west + b.east) / 2
			b.west = c - minSpanDeg / 2
			b.east = c + minSpanDeg / 2
		}
		if b.north - b.south < minSpanDeg {
			let c = (b.north + b.south) / 2
			b.south = c - minSpanDeg / 2
			b.north = c + minSpanDeg / 2
		}
		b.south = max(-cameraMaxLat, min(cameraMaxLat, b.south))
		b.north = max(-cameraMaxLat, min(cameraMaxLat, b.north))
		let need = min(minSpanDeg, 2 * cameraMaxLat)
		if b.north - b.south < need {
			if b.north >= cameraMaxLat { b.south = cameraMaxLat - need } else { b.north = -cameraMaxLat + need }
		}
		return b
	}

	/// Central angle between two points in radians.
	static func centralAngle(_ a: GeoPoint, _ b: GeoPoint) -> Double {
		let rad = Double.pi / 180
		let h = pow(sin((b.lat - a.lat) * rad / 2), 2)
			+ cos(a.lat * rad) * cos(b.lat * rad) * pow(sin((b.lng - a.lng) * rad / 2), 2)
		return 2 * asin(min(1, h.squareRoot()))
	}

	/// Smallest longitude interval containing all `lngs`; `east > 180` when it crosses the
	/// antimeridian.
	static func lngExtent(_ lngs: [Double]) -> (west: Double, east: Double) {
		let sorted = Set(lngs.map { l -> Double in
			let n = normalizeLng(l)
			return n == 180 ? -180 : n
		}).sorted()
		guard let first = sorted.first, let last = sorted.last else { return (-180, 180) }
		if sorted.count == 1 { return (first, first) }
		// The largest gap between neighbours (including the wrap-around gap) is left outside.
		var gapIndex = sorted.count - 1
		var gap = first + 360 - last
		for i in 0..<(sorted.count - 1) where sorted[i + 1] - sorted[i] > gap {
			gap = sorted[i + 1] - sorted[i]
			gapIndex = i
		}
		if gapIndex == sorted.count - 1 { return (first, last) }
		return (sorted[gapIndex + 1], sorted[gapIndex] + 360)
	}
}
