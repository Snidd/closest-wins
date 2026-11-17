import Testing
@testable import ClosestWinsCore

@Suite struct DisplayLanguageTests {
	@Test func forcedBeatsGameAndDevice() {
		#expect(displayLanguage(forced: .sv, game: .en, preferredLanguages: ["en-US"]) == .sv)
	}

	@Test func forcedBeatsDeviceBeforePairing() {
		#expect(displayLanguage(forced: .sv, game: nil, preferredLanguages: ["en-US"]) == .sv)
	}

	@Test func unforcedGameBeatsDevice() {
		#expect(displayLanguage(forced: nil, game: .en, preferredLanguages: ["sv-SE"]) == .en)
	}

	@Test func unforcedSwedishDevice() {
		#expect(displayLanguage(forced: nil, game: nil, preferredLanguages: ["sv-SE"]) == .sv)
	}

	@Test func unforcedOtherOrNoDeviceLanguageIsEnglish() {
		#expect(displayLanguage(forced: nil, game: nil, preferredLanguages: ["en-GB"]) == .en)
		#expect(displayLanguage(forced: nil, game: nil, preferredLanguages: []) == .en)
	}
}
