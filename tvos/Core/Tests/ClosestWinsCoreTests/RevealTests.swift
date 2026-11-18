import Foundation
import Testing
@testable import ClosestWinsCore

@Suite struct RevealTests {
	func timing(at now: Double, skipped: Bool = false) -> RevealTiming {
		RevealTiming(revealStartedAt: 10_000, answerVisibleAt: 13_000, skipped: skipped, now: now, flyMs: 2800, linesMs: 1600)
	}

	@Test func stagesFollowTheServerTimestamps() {
		#expect(timing(at: 10_000).stage == .pins)
		#expect(timing(at: 12_999).stage == .pins)
		#expect(timing(at: 13_000).stage == .flying)
		#expect(timing(at: 15_799).stage == .flying)
		#expect(timing(at: 15_800).stage == .lines)
		#expect(timing(at: 17_399).stage == .lines)
		#expect(timing(at: 17_400).stage == .done)
	}

	@Test func progressAndBoundaries() {
		let pins = timing(at: 11_500)
		#expect(pins.progress == 0.5)
		#expect(pins.endsAt == 13_000)
		let lines = timing(at: 16_600)
		#expect(lines.progress == 0.5)
		#expect(lines.startsAt == 15_800)
		#expect(lines.endsAt == 17_400)
		let done = timing(at: 99_000)
		#expect(done.progress == 1)
		#expect(done.endsAt == .infinity)
	}

	@Test func skippedIsDoneAtOnce() {
		#expect(timing(at: 10_000, skipped: true).stage == .done)
	}

	@Test func fixtureRevealStartsWithPins() throws {
		let snap = try #require(try fixture("reveal").snapshot)
		guard case .reveal(let result, _) = snap.phase else {
			Issue.record("not a reveal")
			return
		}
		#expect(RevealTiming(result, now: snap.serverNow, flyMs: 2800, linesMs: 1600).stage == .pins)
	}

	func guess(_ id: String, km: Double, rank: Int, winner: Bool = false, lat: Double = 0, lng: Double = 0) -> RevealGuess {
		RevealGuess(playerId: id, lat: lat, lng: lng, distanceKm: km, rank: rank, isWinner: winner, locked: true)
	}

	@Test func cameraFramesWinnersAndCloseRunnersUp() {
		let guesses = [
			guess("a", km: 50, rank: 1, winner: true),
			guess("b", km: 400, rank: 2),  // within max(3 × 50, 600)
			guess("c", km: 900, rank: 3),  // too far
			guess("d", km: 500, rank: 4)  // close, but not top three
		]
		#expect(RevealGeometry.framedGuesses(guesses).map(\.playerId) == ["a", "b"])
		let far = [guess("a", km: 1000, rank: 1, winner: true), guess("b", km: 2900, rank: 2), guess("c", km: 3100, rank: 3)]
		#expect(RevealGeometry.framedGuesses(far).map(\.playerId) == ["a", "b"])
	}

	@Test func answerBoundsHaveAMinimumSpan() {
		let target = GeoPoint(lat: 48.8584, lng: 2.2945)
		let b = RevealGeometry.answerBounds(target: target, guesses: [])
		#expect(abs(b.latSpan - 1.5) < 1e-9)
		#expect(abs(b.lngSpan - 1.5) < 1e-9)
		#expect(abs(b.center.lat - target.lat) < 1e-9)
	}

	@Test func answerBoundsContainTheFramedGuess() {
		let target = GeoPoint(lat: 48.8584, lng: 2.2945)
		let b = RevealGeometry.answerBounds(
			target: target,
			guesses: [guess("a", km: 330, rank: 1, winner: true, lat: 51.3584, lng: 4.7945)]
		)
		#expect(b.south <= 48.8584 && b.north >= 51.3584)
		#expect(b.west <= 2.2945 && b.east >= 4.7945)
	}

	@Test func boundsStayCompactAcrossTheAntimeridian() {
		let target = GeoPoint(lat: -17, lng: 178)
		let b = RevealGeometry.answerBounds(
			target: target,
			guesses: [guess("a", km: 500, rank: 1, winner: true, lat: -17, lng: -177)]
		)
		#expect(b.lngSpan < 10)
		#expect(b.east > 180)
	}

	// Close mode: the same cases as `close mode` in `src/lib/map/reveal.test.ts`.

	/// A guess the way the web tests write one: the winner is rank 1.
	func g(_ id: String, _ lat: Double, _ lng: Double, _ km: Double, _ rank: Int) -> RevealGuess {
		guess(id, km: km, rank: rank, winner: rank == 1, lat: lat, lng: lng)
	}

	let stockholm = GeoPoint(lat: 59.33, lng: 18.07)

	func contains(_ b: GeoBounds, _ lat: Double, _ lng: Double) -> Bool {
		lng >= b.west && lng <= b.east && lat >= b.south && lat <= b.north
	}

	@Test func closeModeIsOffWithoutCloseGuesses() {
		let guesses = [g("a", 59, 18, 150, 1), g("b", 60, 19, 300, 2), g("c", -30, 150, 15000, 3)]
		#expect(RevealGeometry.closeGuesses(guesses).isEmpty)
		#expect(RevealGeometry.answerMaxZoom(guesses) == RevealGeometry.defaultAnswerMaxZoom)
		#expect(RevealGeometry.framedGuesses(guesses).map(\.playerId) == ["a", "b"])
	}

	@Test func closeModeIsOffWithExactlyOneCloseGuess() {
		let guesses = [
			g("a", 59.42, 18.07, 10, 1),
			g("b", 60.68, 18.07, 150, 2),
			g("c", 54.0, 18.07, 600, 3),
			g("d", 41.3, 18.07, 2000, 4)
		]
		#expect(RevealGeometry.closeGuesses(guesses).isEmpty)
		#expect(RevealGeometry.framedGuesses(guesses).map(\.playerId) == ["a", "b", "c"])
		#expect(RevealGeometry.answerMaxZoom(guesses) == RevealGeometry.defaultAnswerMaxZoom)
		let b = RevealGeometry.answerBounds(
			target: stockholm, guesses: [g("a", 59.42, 18.07, 10, 1), g("d", 41.3, 18.07, 2000, 4)])
		#expect(b.lngSpan >= 1.5)
		#expect(b.latSpan >= 1.5)
	}

	@Test func closeModeIsOnWithTwoOrMoreCloseGuesses() {
		let guesses = [g("a", 59.37, 18.07, 5, 1), g("b", 59.33, 18.9, 40, 2), g("c", 59.33, 19.6, 90, 3)]
		#expect(RevealGeometry.closeGuesses(guesses).map(\.playerId) == ["a", "b", "c"])
		#expect(RevealGeometry.answerMaxZoom(guesses) == 10)
	}

	@Test func closeModeFramesOnlyTheCloseGuesses() {
		let guesses = [
			g("a", 59.375, 18.07, 5, 1), g("b", 59.33, 18.775, 40, 2),
			g("c", 62.03, 18.07, 300, 3), g("d", 41.3, 18.07, 2000, 4)
		]
		#expect(RevealGeometry.framedGuesses(guesses).map(\.playerId) == ["a", "b"])
		let b = RevealGeometry.answerBounds(target: stockholm, guesses: guesses)
		#expect(contains(b, 59.375, 18.07))
		#expect(contains(b, 59.33, 18.775))
		#expect(!contains(b, 62.03, 18.07))
	}

	@Test func closeModeFramesTiedWinners() {
		let guesses = [g("a", 59.6, 18.07, 30, 1), g("b", 59.06, 18.07, 30, 1), g("c", 50, 10, 1100, 3)]
		#expect(guesses.filter(\.isWinner).count == 2)
		#expect(RevealGeometry.closeGuesses(guesses).map(\.playerId) == ["a", "b"])
		#expect(RevealGeometry.framedGuesses(guesses).map(\.playerId) == ["a", "b"])
	}

	@Test func aGuessAtExactlyTheCloseDistanceCounts() {
		let a = g("a", 59.37, 18.07, 5, 1)
		let km = RevealGeometry.closeGuessKm
		#expect(RevealGeometry.closeGuesses([a, g("b", 60.23, 18.07, km, 2)]).map(\.playerId) == ["a", "b"])
		#expect(RevealGeometry.closeGuesses([a, g("b", 60.23, 18.07, km + 0.01, 2)]).isEmpty)
	}

	@Test func closeModeBoundsStayCompactAcrossTheAntimeridian() {
		// Near Fiji, close enough to ±180 that guesses on both sides are within 100 km.
		let fiji = GeoPoint(lat: -17.7, lng: 179.7)
		let guesses = [g("a", -17.7, 179.6, 11, 1), g("b", -17.75, -179.8, 53, 2)]
		#expect(RevealGeometry.answerMaxZoom(guesses) == 10)
		let b = RevealGeometry.answerBounds(target: fiji, guesses: guesses)
		#expect(b.west < b.east)
		#expect(b.lngSpan < 2)
	}

	@Test func closeModePadsToTheCloseMinimumSpan() {
		let guesses = [g("a", 59.357, 18.07, 3, 1), g("b", 59.33, 18.158, 5, 2)]
		let b = RevealGeometry.answerBounds(target: stockholm, guesses: guesses)
		for span in [b.lngSpan, b.latSpan] {
			#expect(span >= RevealGeometry.closeMinSpanDeg - 1e-9)
			#expect(span < 1.5)
		}
	}

	@Test func padBoundsKeepsASmallSpanInPlace() {
		// 59.3435 ± 0.05 spans 0.0999999… in floating point.
		let b = RevealGeometry.padBounds(GeoBounds(west: 18, south: 59.33, east: 18.2, north: 59.357), minSpanDeg: 0.1)
		#expect(abs(b.south - 59.2935) < 1e-9)
		#expect(abs(b.north - 59.3935) < 1e-9)
	}

	@Test func guessesBoundsSpanAtLeastTwentyDegrees() {
		let b = RevealGeometry.guessesBounds([GeoPoint(lat: 10, lng: 10)])
		#expect(b?.latSpan == 20)
		#expect(b?.lngSpan == 20)
		#expect(RevealGeometry.guessesBounds([]) == nil)
	}

	@Test func greatCirclePathIsContinuousAndEndsOnBothPoints() {
		let tokyo = GeoPoint(lat: 35.68, lng: 139.69)
		let la = GeoPoint(lat: 34.05, lng: -118.24)
		let path = RevealGeometry.greatCirclePath(tokyo, la)
		#expect(path.first == tokyo)
		#expect(path.last?.lat == la.lat)
		// Across the Pacific, not the long way round.
		#expect(abs((path.last?.lng ?? 0) - (la.lng + 360)) < 1e-9)
		for (a, b) in zip(path, path.dropFirst()) {
			#expect(abs(b.lng - a.lng) < 180)
		}
		// The great circle bends north of both cities.
		#expect((path.map(\.lat).max() ?? 0) > 45)
	}

	@Test func slicePathCutsByFraction() {
		let path = (0...4).map { GeoPoint(lat: 0, lng: Double($0)) }
		#expect(RevealGeometry.slicePath(path, fraction: 1) == path)
		#expect(RevealGeometry.slicePath(path, fraction: 0.5).last?.lng == 2)
		#expect(RevealGeometry.slicePath(path, fraction: 0.375).last?.lng == 1.5)
		#expect(RevealGeometry.slicePath(path, fraction: 0).count == 2)
	}
}

@Suite struct ConnectionTests {
	@Test func sseLines() {
		#expect(SSELine(#"data: {"role":"tv"}"#) == .event(Data(#"{"role":"tv"}"#.utf8)))
		#expect(SSELine(#"data:{"a":1}"#) == .event(Data(#"{"a":1}"#.utf8)))
		#expect(SSELine(": keep-alive") == .comment)
		#expect(SSELine("event: x") == .ignored)
		#expect(SSELine("") == .ignored)
	}

	@Test func backoffDoublesUpToThirtySeconds() {
		#expect((0...6).map { TvConnection.backoffSeconds(attempt: $0) } == [2, 4, 8, 16, 30, 30, 30])
	}

	@Test func serverAddressFromText() {
		#expect(Discovery.serverURL(from: "192.168.1.20:5173")?.absoluteString == "http://192.168.1.20:5173")
		#expect(Discovery.serverURL(from: " http://studio.local:5173/ ")?.absoluteString == "http://studio.local:5173")
		#expect(Discovery.serverURL(from: "https://play.example.com/tv")?.absoluteString == "https://play.example.com")
		#expect(Discovery.serverURL(from: "") == nil)
		#expect(Discovery.serverURL(from: "ftp://x") == nil)
	}
}
