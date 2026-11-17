import ClosestWinsCore
import Observation
import SwiftUI

/// The app's state: which server, what the server last said, and whether we still hear it.
@MainActor @Observable
final class AppModel {
	let shared: Shared

	/// The game server, e.g. `http://192.168.1.20:5173`. Nil until one is chosen on the Setup
	/// screen; remembered between launches.
	private(set) var server: URL?
	/// The last state from the server; nil until the first one arrives. Kept while offline.
	private(set) var state: TvState?
	private(set) var clock = ServerClock()
	/// No connection for a few seconds: shows the "reconnecting" pill.
	private(set) var offline = false

	@ObservationIgnored private var connection: Task<Void, Never>?
	@ObservationIgnored private var offlineTimer: Task<Void, Never>?

	private static let serverKey = "server"

	init() {
		guard let url = Bundle.main.url(forResource: "shared", withExtension: "json"),
			let shared = try? Shared.load(from: url)
		else { fatalError("shared.json is missing or does not decode: run `pnpm tvos:export`") }
		self.shared = shared

		#if DEBUG
			if let name = UserDefaults.standard.string(forKey: "fixture") {
				showFixture(name)
				return
			}
		#endif
		if let saved = UserDefaults.standard.string(forKey: Self.serverKey), let url = Discovery.serverURL(from: saved) {
			connect(to: url)
		}
	}

	/// Forces the app's language on every screen, ignoring the language the host chose for the game
	/// and the Apple TV's language. Set to `nil` to follow the game's language once paired and the
	/// device locale before that, the same as the web `/tv`.
	static let forcedLanguage: Lang? = .sv

	/// `forcedLanguage` if set, otherwise the game's language once paired, the device's before that.
	var lang: Lang {
		displayLanguage(
			forced: Self.forcedLanguage,
			game: state?.snapshot?.game.language,
			preferredLanguages: Foundation.Locale.preferredLanguages
		)
	}

	var t: Strings { Strings(shared, lang) }

	/// The server as people type it: "192.168.1.20:5173".
	var serverHost: String {
		guard let server, let host = server.host() else { return "" }
		return server.port.map { "\(host):\($0)" } ?? host
	}

	/// Photo URLs in snapshots are relative to the server.
	func mediaURL(_ path: String) -> URL? {
		server.flatMap { URL(string: path, relativeTo: $0) }
	}

	func connect(to url: URL) {
		connection?.cancel()
		server = url
		state = nil
		UserDefaults.standard.set(url.absoluteString, forKey: Self.serverKey)
		startOfflineTimer()

		let tokenKey = "token:\(url.absoluteString)"
		let link = TvConnection(
			server: url,
			loadToken: { UserDefaults.standard.string(forKey: tokenKey) },
			saveToken: { UserDefaults.standard.set($0, forKey: tokenKey) }
		)
		connection = Task {
			await link.run { [weak self] event in await self?.handle(event) }
		}
	}

	/// Back to the Setup screen.
	func forgetServer() {
		connection?.cancel()
		offlineTimer?.cancel()
		connection = nil
		server = nil
		state = nil
		offline = false
		UserDefaults.standard.removeObject(forKey: Self.serverKey)
	}

	private func handle(_ event: TvConnection.Event) {
		switch event {
		case .state(let value, let receivedAt):
			offlineTimer?.cancel()
			offlineTimer = nil
			offline = false
			if let serverNow = value.serverNow {
				clock = ServerClock(serverNow: serverNow, receivedAt: receivedAt)
			}
			// `unregistered` only means "registering": keep what is on screen.
			if value != .unregistered || state?.snapshot == nil { state = value }
		case .disconnected:
			startOfflineTimer()
		}
	}

	private func startOfflineTimer() {
		guard offlineTimer == nil else { return }
		offlineTimer = Task { [weak self] in
			try? await Task.sleep(for: .seconds(2.5))
			if !Task.isCancelled { self?.offline = true }
		}
	}

	#if DEBUG
		/// `-fixture reveal` on the command line shows `tvos/Fixtures/reveal.json` instead of
		/// connecting, with the clock set so the snapshot is "now". For looking at one screen
		/// in the simulator without playing a game.
		private func showFixture(_ name: String) {
			guard let url = Bundle.main.url(forResource: name, withExtension: "json", subdirectory: "Fixtures"),
				let data = try? Data(contentsOf: url),
				let value = try? JSONDecoder().decode(TvState.self, from: data)
			else { fatalError("No fixture named \(name)") }
			server = URL(string: "http://192.168.1.20:5173")
			state = value
			if let serverNow = value.serverNow { clock = ServerClock(serverNow: serverNow) }
		}
	#endif
}
