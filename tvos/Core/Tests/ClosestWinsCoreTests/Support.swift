import Foundation
@testable import ClosestWinsCore

/// `tvos/`, found from this file's place in the repo: the tests read the generated files
/// where they are instead of keeping copies.
let tvosDirectory = URL(fileURLWithPath: #filePath)
	.deletingLastPathComponent()  // ClosestWinsCoreTests
	.deletingLastPathComponent()  // Tests
	.deletingLastPathComponent()  // Core
	.deletingLastPathComponent()  // tvos

let fixturesDirectory = tvosDirectory.appending(path: "Fixtures")

func loadShared() throws -> Shared {
	try Shared.load(from: tvosDirectory.appending(path: "ClosestWins/Resources/shared.json"))
}

func fixture(_ name: String) throws -> TvState {
	let data = try Data(contentsOf: fixturesDirectory.appending(path: "\(name).json"))
	return try JSONDecoder().decode(TvState.self, from: data)
}
