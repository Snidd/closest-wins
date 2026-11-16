import Foundation

/// The two endpoints the server has for the Apple TV app (`src/routes/tv/native/`).
public struct TvClient: Sendable {
	public struct Registration: Decodable, Sendable {
		public let tvId: String
		/// A new token to store, or nil when the token that was sent is still valid.
		public let token: String?
	}

	public enum Failure: Error, Equatable {
		case http(Int)
	}

	/// The server address, e.g. `http://192.168.1.20:5173`.
	public let server: URL
	private let session: URLSession

	public init(server: URL) {
		self.server = server
		let config = URLSessionConfiguration.ephemeral
		// The stream is silent for at most 30 s (keep-alive comments), so a longer silence
		// means the connection is dead even if the network has not noticed.
		config.timeoutIntervalForRequest = 75
		config.timeoutIntervalForResource = .infinity
		config.requestCachePolicy = .reloadIgnoringLocalCacheData
		session = URLSession(configuration: config)
	}

	/// Registers this screen, or confirms `token` if the server still knows it.
	public func register(token: String?) async throws -> Registration {
		var request = URLRequest(url: server.appending(path: "tv/native/register"))
		request.httpMethod = "POST"
		// Required: without a JSON content type the server rejects the POST as cross-site (403).
		request.setValue("application/json", forHTTPHeaderField: "Content-Type")
		request.httpBody = Data("{}".utf8)
		request.timeoutInterval = 10
		if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
		let (data, response) = try await session.data(for: request)
		try Self.check(response)
		return try JSONDecoder().decode(Registration.self, from: data)
	}

	/// The states of this screen: the current one at once, then one per change. Ends when the
	/// server closes the stream (always right after `unregistered`), throws when it breaks.
	public func states(token: String) -> AsyncThrowingStream<TvState, Error> {
		var request = URLRequest(url: server.appending(path: "tv/native/stream"))
		request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
		request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
		return AsyncThrowingStream { continuation in
			let task = Task { [session, request] in
				do {
					let (bytes, response) = try await session.bytes(for: request)
					try Self.check(response)
					let decoder = JSONDecoder()
					for try await line in bytes.lines {
						if case .event(let data) = SSELine(line) {
							continuation.yield(try decoder.decode(TvState.self, from: data))
						}
					}
					continuation.finish()
				} catch {
					continuation.finish(throwing: error)
				}
			}
			continuation.onTermination = { _ in task.cancel() }
		}
	}

	private static func check(_ response: URLResponse) throws {
		let status = (response as? HTTPURLResponse)?.statusCode ?? 0
		guard status == 200 else { throw Failure.http(status) }
	}
}

/// Keeps a screen connected: registers when needed, follows the stream, and reconnects when
/// it ends or breaks. Same rules as the web TV (`src/routes/tv/+page.svelte`).
public struct TvConnection: Sendable {
	public enum Event: Sendable {
		/// A state arrived. `receivedAt` is for the clock offset.
		case state(TvState, receivedAt: Date)
		/// The stream ended or broke; a reconnect follows.
		case disconnected
	}

	private let client: TvClient
	private let loadToken: @Sendable () -> String?
	private let saveToken: @Sendable (String) -> Void

	public init(
		server: URL,
		loadToken: @escaping @Sendable () -> String?,
		saveToken: @escaping @Sendable (String) -> Void
	) {
		client = TvClient(server: server)
		self.loadToken = loadToken
		self.saveToken = saveToken
	}

	/// Delay before reconnect number `attempt` (0-based): 2, 4, 8, 16, 30, 30… seconds.
	public static func backoffSeconds(attempt: Int) -> Double {
		min(30, 2 * pow(2, Double(min(attempt, 10))))
	}

	/// Runs until the task is cancelled.
	public func run(onEvent: @escaping @Sendable (Event) async -> Void) async {
		var token = loadToken()
		var mustRegister = token == nil
		var attempt = 0
		while !Task.isCancelled {
			if mustRegister {
				do {
					// A token the server no longer knows gets a new screen and a new token.
					if let fresh = try await client.register(token: token).token {
						token = fresh
						saveToken(fresh)
					}
					mustRegister = false
				} catch {
					// 429 is the limit on new screens per address: do not hammer it.
					let limited = (error as? TvClient.Failure) == .http(429)
					await Self.sleep(limited ? 30 : 3)
					continue
				}
			}
			guard let token else {
				mustRegister = true
				continue
			}
			do {
				for try await state in client.states(token: token) {
					attempt = 0
					if state == .unregistered { mustRegister = true }
					await onEvent(.state(state, receivedAt: Date()))
				}
			} catch {}
			if Task.isCancelled { return }
			// After `unregistered` the server ends the stream on purpose: register at once.
			if mustRegister { continue }
			await onEvent(.disconnected)
			await Self.sleep(Self.backoffSeconds(attempt: attempt))
			attempt += 1
		}
	}

	private static func sleep(_ seconds: Double) async {
		try? await Task.sleep(for: .seconds(seconds))
	}
}
