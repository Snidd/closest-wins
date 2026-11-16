// swift-tools-version: 6.0
import PackageDescription

// Everything in the Apple TV app that is not a view: the snapshot model, the server client and
// the rules shared with the web (strings, distance format, reveal timing). Kept in a package so
// it tests with `swift test` on the Mac, without a simulator.
let package = Package(
	name: "ClosestWinsCore",
	platforms: [.tvOS(.v17), .macOS(.v14)],
	products: [
		.library(name: "ClosestWinsCore", targets: ["ClosestWinsCore"])
	],
	targets: [
		.target(name: "ClosestWinsCore"),
		.testTarget(name: "ClosestWinsCoreTests", dependencies: ["ClosestWinsCore"])
	]
)
