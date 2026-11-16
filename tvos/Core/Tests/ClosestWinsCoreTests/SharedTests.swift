import Foundation
import Testing
@testable import ClosestWinsCore

@Suite struct SharedTests {
	@Test func distanceMatchesEveryWebSample() throws {
		let shared = try loadShared()
		var checked = 0
		for lang in Lang.allCases {
			let examples = try #require(shared.distanceFormat.examples[lang.rawValue])
			for example in examples {
				#expect(formatDistance(example.km, lang) == example.text, "\(example.km) km in \(lang)")
				checked += 1
			}
		}
		#expect(checked == 24)
	}

	@Test func distanceRoundsHalfAwayFromZero() {
		#expect(formatDistance(3.25, .sv) == "3,3 km")
		#expect(formatDistance(3.25, .en) == "3.3 km")
		#expect(formatDistance(2.5, .en) == "2.5 km")
		#expect(formatDistance(10.5, .en) == "11 km")
		#expect(formatDistance(11.5, .en) == "12 km")
		#expect(formatDistance(1234.4, .sv) == "1\u{00A0}234 km")
		#expect(formatDistance(53.176729649468065, .en) == "53 km")
		#expect(formatDistance(1_234_567.8, .en) == "1,234,568 km")
	}

	@Test func plainAndParameterMessages() throws {
		let en = Strings(try loadShared(), .en)
		let sv = Strings(try loadShared(), .sv)
		#expect(en.tv("pairingTitle") == "Pair this screen")
		#expect(sv.tv("pairingTitle") == "Para ihop skärmen")
		#expect(en.tv("lockedIn", ["n": 2, "total": 5]) == "2 of 5 locked in")
		#expect(sv.tv("lockedIn", ["n": 2, "total": 5]) == "2 av 5 har låst")
		#expect(en.common("roundOf", ["n": 1, "total": 3]) == "Round 1 of 3")
		#expect(en.tv("away", ["km": .text(en.km(0.42))]) == "420 m away")
	}

	@Test func casesPickThePluralForm() throws {
		let en = Strings(try loadShared(), .en)
		#expect(en.tv("guessCount", ["n": 1]) == "1 guess")
		#expect(en.tv("guessCount", ["n": 4]) == "4 guesses")
		#expect(en.tv("roundsAndTimer", ["rounds": 1, "seconds": 30]) == "1 round · 30 s each")
		#expect(en.tv("roundsAndTimer", ["rounds": 5, "seconds": 30]) == "5 rounds · 30 s each")
	}

	@Test func bothLanguagesHaveTheSameKeys() throws {
		let shared = try loadShared()
		for dict in ["common", "tv"] {
			let en = try #require(shared.strings[dict]?["en"])
			let sv = try #require(shared.strings[dict]?["sv"])
			#expect(Set(en.keys) == Set(sv.keys))
		}
	}

	@Test func constants() throws {
		let shared = try loadShared()
		#expect(shared.version == 2)
		#expect(shared.playerColors.count == 40)
		#expect(shared.textColor(on: "#e6424a") == "#000000")
		#expect(shared.textColor(on: "#0867A9") == "#ffffff")
		#expect(shared.reveal.flyMs == 2800)
		#expect(shared.reveal.linesMs == 1600)
		#expect(shared.game.maxPlayers == 40)
		#expect(shared.pairing.codeLength == 6)
	}

	/// The app looks strings up by name: every name it uses must exist in `shared.json`.
	@Test func everyStringTheAppUsesExists() throws {
		let shared = try loadShared()
		let sources = tvosDirectory.appending(path: "ClosestWins")
		let pattern = /\.(tv|common)\("([A-Za-z]+)"/
		var used = 0
		let files = FileManager.default.enumerator(at: sources, includingPropertiesForKeys: nil)
		while let file = files?.nextObject() as? URL {
			guard file.pathExtension == "swift" else { continue }
			let text = try String(contentsOf: file, encoding: .utf8)
			for match in text.matches(of: pattern) {
				let dict: Shared.Dict = match.1 == "tv" ? .tv : .common
				#expect(
					shared.message(dict, String(match.2), .en) != nil,
					"\(file.lastPathComponent) uses \(match.1).\(match.2)"
				)
				used += 1
			}
		}
		#expect(used > 0)
	}
}
