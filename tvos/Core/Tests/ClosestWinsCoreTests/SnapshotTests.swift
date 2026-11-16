import Foundation
import Testing
@testable import ClosestWinsCore

@Suite struct SnapshotTests {
	/// Every fixture and the state it must decode to. A new fixture fails `decodesEveryFixture`
	/// until it is listed here.
	static let expected: [String: String] = [
		"unregistered": "unregistered",
		"pairing": "pairing",
		"lobby": "lobby",
		"round-photo": "round",
		"round-text": "round",
		"round-photo-text": "round",
		"round-sudden-death": "round",
		"reveal": "reveal",
		"reveal-skipped": "reveal",
		"standings": "standings",
		"standings-sudden-death": "standings",
		"standings-final": "standings",
		"finished": "finished"
	]

	static func kind(_ state: TvState) -> String {
		switch state {
		case .unregistered: "unregistered"
		case .pairing: "pairing"
		case .paired(let snap):
			switch snap.phase {
			case .lobby: "lobby"
			case .round: "round"
			case .reveal: "reveal"
			case .standings: "standings"
			case .finished: "finished"
			}
		}
	}

	@Test func decodesEveryFixture() throws {
		let files = try FileManager.default.contentsOfDirectory(atPath: fixturesDirectory.path)
			.filter { $0.hasSuffix(".json") }
			.map { String($0.dropLast(5)) }
		#expect(Set(files) == Set(Self.expected.keys))
		for name in files {
			#expect(Self.kind(try fixture(name)) == Self.expected[name], "\(name).json")
		}
	}

	@Test func pairing() throws {
		guard case .pairing(let now, let code) = try fixture("pairing") else {
			Issue.record("not pairing")
			return
		}
		#expect(code.pairingCode == "482913")
		#expect(now == 1_794_855_600_000)
		#expect(code.codeExpiresAt == 1_794_856_200_000)
	}

	@Test func roundCarriesClueAndLockIns() throws {
		let snap = try #require(try fixture("round-photo").snapshot)
		guard case .round(let round, let locked) = snap.phase else {
			Issue.record("not a round")
			return
		}
		#expect(snap.game.joinUrl == "http://192.168.1.20:5173/join/KDRW")
		#expect(snap.game.language == .en)
		#expect(round.clue.photo?.urls.lg == "/media/fixturePhotoKey1000000/lg.webp")
		#expect(round.clue.textEn == nil)
		#expect(locked == ["20000000-0000-4000-8000-000000000001"])
		#expect(snap.players.count == 3)
		#expect(snap.nextPairing == nil)
	}

	@Test func suddenDeathRound() throws {
		let snap = try #require(try fixture("round-sudden-death").snapshot)
		guard case .round(let round, _) = snap.phase else {
			Issue.record("not a round")
			return
		}
		#expect(round.isSuddenDeath)
		#expect(round.eligiblePlayerIds.count == 2)
		#expect(snap.game.language == .sv)
	}

	@Test func revealCarriesAnswerAndCredit() throws {
		let snap = try #require(try fixture("reveal").snapshot)
		guard case .reveal(let result, let standings) = snap.phase else {
			Issue.record("not a reveal")
			return
		}
		#expect(result.target.nameEn == "Eiffel Tower")
		#expect(result.round.clue.photo?.attribution == "Eiffel Tower at dusk by Jane Doe, CC BY-SA 4.0")
		#expect(result.guesses.first?.isWinner == true)
		// Two guesses: one pin every 500 ms, then a 1500 ms hold.
		#expect(result.answerVisibleAt - result.revealStartedAt == 2500)
		#expect(result.guesses.map { $0.revealAt - result.revealStartedAt }.sorted() == [500, 1000])
		#expect(!result.skipped)
		// A whole number in the JSON (`0`) still decodes as a distance.
		#expect(standings.last?.totalDistanceKm == 0)
	}

	@Test func nextSteps() throws {
		func next(_ name: String) throws -> NextStep? {
			guard case .standings(_, _, let next) = try fixture(name).snapshot?.phase else { return nil }
			return next
		}
		#expect(try next("standings") == .round(number: 2))
		guard case .suddenDeath(let duel) = try next("standings-sudden-death") else {
			Issue.record("not sudden death")
			return
		}
		#expect(duel.count == 2)
		#expect(try next("standings-final") == .finish(winnerPlayerIds: ["20000000-0000-4000-8000-000000000001"]))
	}

	@Test func finishedHasNextPairingCode() throws {
		let snap = try #require(try fixture("finished").snapshot)
		guard case .finished(let standings, let winners, let endedEarly) = snap.phase else {
			Issue.record("not finished")
			return
		}
		#expect(snap.nextPairing?.pairingCode == "730164")
		#expect(winners == ["20000000-0000-4000-8000-000000000001"])
		#expect(!endedEarly)
		#expect(standings.count == 4)
	}

	@Test func movementSinceTheLastRound() throws {
		// The fixture is the standings after round 1, which Alice won.
		guard case .standings(let result, let standings, _) = try fixture("standings").snapshot?.phase else {
			Issue.record("not standings")
			return
		}
		let moves = movement(standings: standings, result: result)
		#expect(moves.count == standings.count)
		for row in standings {
			let move = try #require(moves[row.playerId])
			#expect(move.wonRound == result.winnerPlayerIds.contains(row.playerId))
			// Before the first round everyone shared first place: nobody can have moved up.
			#expect(move.delta == 1 - row.rank)
		}
	}

	@Test func unknownPhaseIsAnError() {
		let json = #"{"role":"tv","status":"paired","phase":"intermission"}"#
		#expect(throws: DecodingError.self) {
			try JSONDecoder().decode(TvState.self, from: Data(json.utf8))
		}
	}

	@Test func contentFallsBackToTheOtherLanguage() {
		#expect(localized(sv: "Hej", en: "Hello", .sv) == "Hej")
		#expect(localized(sv: nil, en: "Hello", .sv) == "Hello")
		#expect(localized(sv: "  ", en: "Hello", .sv) == "Hello")
		#expect(localized(sv: nil, en: nil, .en) == "")
	}

	@Test func clockOffset() {
		let local = Date(timeIntervalSince1970: 1000)
		let clock = ServerClock(serverNow: 1_005_000, receivedAt: local)
		#expect(clock.offsetMs == 5000)
		#expect(clock.now(local) == 1_005_000)
		#expect(clock.remainingMs(until: 1_006_500, local: local) == 1500)
		#expect(clock.remainingMs(until: 1_000_000, local: local) == 0)
		#expect(clock.localDate(1_005_000) == local)
	}
}
