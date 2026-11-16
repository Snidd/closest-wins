import Foundation

/// The server's clock as seen from this device (`src/lib/game/clock.ts`). Every snapshot carries
/// `serverNow`; the offset is taken when it arrives and used until the next one.
public struct ServerClock: Sendable, Equatable {
	/// `serverNow - localNow` in ms. Add it to the local time to get the server's.
	public var offsetMs: Double

	public init(offsetMs: Double = 0) {
		self.offsetMs = offsetMs
	}

	public init(serverNow: EpochMs, receivedAt: Date = Date()) {
		offsetMs = serverNow - receivedAt.epochMs
	}

	public func now(_ local: Date = Date()) -> EpochMs {
		local.epochMs + offsetMs
	}

	/// Milliseconds left until `endsAt` (server clock), never negative.
	public func remainingMs(until endsAt: EpochMs, local: Date = Date()) -> Double {
		max(0, endsAt - now(local))
	}

	/// The local time at which the server clock reads `serverTime`.
	public func localDate(_ serverTime: EpochMs) -> Date {
		Date(timeIntervalSince1970: (serverTime - offsetMs) / 1000)
	}
}

extension Date {
	public var epochMs: EpochMs { timeIntervalSince1970 * 1000 }
}
