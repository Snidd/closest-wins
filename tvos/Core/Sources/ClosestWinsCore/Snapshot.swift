import Foundation

// Mirror of `TvStateValue` in `src/lib/game/types.ts`: what `/tv/native/stream` sends.
// Field names are the JSON keys. `tvos/Fixtures` holds one real value per state; the tests
// decode all of them.

/// Epoch milliseconds on the server clock.
public typealias EpochMs = Double

public enum Lang: String, Codable, Sendable, CaseIterable {
	case sv, en
}

public struct PhotoUrls: Decodable, Sendable, Equatable {
	/// Relative to the server address (`/media/<key>/<size>.webp`).
	public let sm: String
	public let md: String
	public let lg: String
}

/// The photo of a running round: the image only. The credit often names the place, so the
/// server sends it with the reveal (`RevealedPhoto`), never here.
public struct CluePhoto: Decodable, Sendable, Equatable {
	public let width: Double
	public let height: Double
	public let urls: PhotoUrls
}

public struct RevealedPhoto: Decodable, Sendable, Equatable {
	public let width: Double
	public let height: Double
	public let urls: PhotoUrls
	public let attribution: String?
	public let sourceUrl: String?

	public var clue: CluePhoto { CluePhoto(width: width, height: height, urls: urls) }
}

public struct Clue: Decodable, Sendable, Equatable {
	public let textSv: String?
	public let textEn: String?
	public let photo: CluePhoto?
}

public struct RevealedClue: Decodable, Sendable, Equatable {
	public let textSv: String?
	public let textEn: String?
	public let photo: RevealedPhoto?
}

public struct BilingualName: Decodable, Sendable, Equatable {
	public let nameSv: String?
	public let nameEn: String?
}

public struct Player: Decodable, Sendable, Equatable, Identifiable {
	public let id: String
	public let nickname: String
	/// `#rrggbb`, assigned by the server.
	public let color: String
	public let connected: Bool
	public let lateJoiner: Bool
}

public struct GameInfo: Decodable, Sendable, Equatable {
	public let id: String
	public let joinCode: String
	/// Absolute, e.g. `http://192.168.1.20:5173/join/KDRW`.
	public let joinUrl: String
	public let language: Lang
	public let playlistName: BilingualName
	public let timerSeconds: Int
	/// Planned regular rounds (sudden death not included).
	public let totalRounds: Int
}

public struct ActiveRound: Decodable, Sendable, Equatable {
	/// 0-based among all rounds, sudden death included.
	public let index: Int
	/// 1-based number among regular rounds, or among sudden-death rounds.
	public let number: Int
	public let isSuddenDeath: Bool
	public let eligiblePlayerIds: [String]
	public let startedAt: EpochMs
	public let endsAt: EpochMs
	public let clue: Clue
}

public struct RoundRef: Decodable, Sendable, Equatable {
	public let index: Int
	public let number: Int
	public let isSuddenDeath: Bool
	public let eligiblePlayerIds: [String]
	public let startedAt: EpochMs
	public let endedAt: EpochMs
	public let clue: RevealedClue
}

public struct RevealTarget: Decodable, Sendable, Equatable {
	public let lat: Double
	public let lng: Double
	public let nameSv: String?
	public let nameEn: String?
	public let factSv: String?
	public let factEn: String?
}

public struct RevealGuess: Decodable, Sendable, Equatable {
	public let playerId: String
	public let lat: Double
	public let lng: Double
	public let distanceKm: Double
	/// 1-based; ties share a rank (1, 1, 3).
	public let rank: Int
	public let isWinner: Bool
	public let locked: Bool
	/// Server time this guess appears on the map: one by one in a mixed order, all before
	/// `answerVisibleAt`. The server decides, so every screen shows the same order.
	public let revealAt: EpochMs

	public init(
		playerId: String, lat: Double, lng: Double, distanceKm: Double, rank: Int, isWinner: Bool, locked: Bool,
		revealAt: EpochMs = 0
	) {
		self.playerId = playerId
		self.lat = lat
		self.lng = lng
		self.distanceKm = distanceKm
		self.rank = rank
		self.isWinner = isWinner
		self.locked = locked
		self.revealAt = revealAt
	}
}

public struct RoundResult: Decodable, Sendable, Equatable {
	public let round: RoundRef
	public let target: RevealTarget
	/// Sorted by distance, closest first.
	public let guesses: [RevealGuess]
	public let noGuessPlayerIds: [String]
	/// Several on an exact tie, empty when nobody guessed.
	public let winnerPlayerIds: [String]
	public let revealStartedAt: EpochMs
	public let answerVisibleAt: EpochMs
	public let skipped: Bool
}

public struct StandingRow: Decodable, Sendable, Equatable {
	public let playerId: String
	public let nickname: String
	public let color: String
	public let connected: Bool
	public let rank: Int
	public let roundsWon: Int
	public let totalDistanceKm: Double
	public let guessedRounds: Int
}

public enum NextStep: Decodable, Sendable, Equatable {
	case round(number: Int)
	case suddenDeath(eligiblePlayerIds: [String])
	case finish(winnerPlayerIds: [String])

	private enum Keys: String, CodingKey { case kind, number, eligiblePlayerIds, winnerPlayerIds }

	public init(from decoder: Decoder) throws {
		let c = try decoder.container(keyedBy: Keys.self)
		let kind = try c.decode(String.self, forKey: .kind)
		switch kind {
		case "round": self = .round(number: try c.decode(Int.self, forKey: .number))
		case "suddenDeath": self = .suddenDeath(eligiblePlayerIds: try c.decode([String].self, forKey: .eligiblePlayerIds))
		case "finish": self = .finish(winnerPlayerIds: try c.decode([String].self, forKey: .winnerPlayerIds))
		default: throw DecodingError.dataCorruptedError(forKey: .kind, in: c, debugDescription: "Unknown next step \(kind)")
		}
	}
}

public struct PairingCode: Decodable, Sendable, Equatable {
	public let pairingCode: String
	public let codeExpiresAt: EpochMs
}

/// The part of a paired snapshot that depends on the phase.
public enum Phase: Sendable, Equatable {
	case lobby
	case round(ActiveRound, lockedPlayerIds: [String])
	case reveal(RoundResult, standings: [StandingRow])
	case standings(RoundResult, standings: [StandingRow], next: NextStep)
	case finished(standings: [StandingRow], winnerPlayerIds: [String], endedEarly: Bool)
}

public struct TvSnapshot: Decodable, Sendable, Equatable {
	public let serverNow: EpochMs
	public let game: GameInfo
	/// Not kicked, in join order.
	public let players: [Player]
	/// Only in `finished`: the code that pairs this screen with the next game.
	public let nextPairing: PairingCode?
	public let phase: Phase

	private enum Keys: String, CodingKey {
		case serverNow, game, players, nextPairing, phase
		case round, lockedPlayerIds, result, standings, next, winnerPlayerIds, endedEarly
	}

	public init(from decoder: Decoder) throws {
		let c = try decoder.container(keyedBy: Keys.self)
		serverNow = try c.decode(EpochMs.self, forKey: .serverNow)
		game = try c.decode(GameInfo.self, forKey: .game)
		players = try c.decode([Player].self, forKey: .players)
		nextPairing = try c.decodeIfPresent(PairingCode.self, forKey: .nextPairing)
		let name = try c.decode(String.self, forKey: .phase)
		switch name {
		case "lobby":
			phase = .lobby
		case "round":
			phase = .round(
				try c.decode(ActiveRound.self, forKey: .round),
				lockedPlayerIds: try c.decode([String].self, forKey: .lockedPlayerIds)
			)
		case "reveal":
			phase = .reveal(
				try c.decode(RoundResult.self, forKey: .result),
				standings: try c.decode([StandingRow].self, forKey: .standings)
			)
		case "standings":
			phase = .standings(
				try c.decode(RoundResult.self, forKey: .result),
				standings: try c.decode([StandingRow].self, forKey: .standings),
				next: try c.decode(NextStep.self, forKey: .next)
			)
		case "finished":
			phase = .finished(
				standings: try c.decode([StandingRow].self, forKey: .standings),
				winnerPlayerIds: try c.decode([String].self, forKey: .winnerPlayerIds),
				endedEarly: try c.decode(Bool.self, forKey: .endedEarly)
			)
		default:
			throw DecodingError.dataCorruptedError(forKey: .phase, in: c, debugDescription: "Unknown phase \(name)")
		}
	}

	public func player(_ id: String) -> Player? {
		players.first { $0.id == id }
	}
}

/// One value of the TV stream.
public enum TvState: Decodable, Sendable, Equatable {
	/// The token is missing or unknown: register, then reconnect. Has no `serverNow`.
	case unregistered
	case pairing(serverNow: EpochMs, PairingCode)
	case paired(TvSnapshot)

	private enum Keys: String, CodingKey { case status, serverNow }

	public init(from decoder: Decoder) throws {
		let c = try decoder.container(keyedBy: Keys.self)
		let status = try c.decode(String.self, forKey: .status)
		switch status {
		case "unregistered": self = .unregistered
		case "pairing": self = .pairing(serverNow: try c.decode(EpochMs.self, forKey: .serverNow), try PairingCode(from: decoder))
		case "paired": self = .paired(try TvSnapshot(from: decoder))
		default: throw DecodingError.dataCorruptedError(forKey: .status, in: c, debugDescription: "Unknown status \(status)")
		}
	}

	public var serverNow: EpochMs? {
		switch self {
		case .unregistered: nil
		case .pairing(let now, _): now
		case .paired(let snap): snap.serverNow
		}
	}

	public var snapshot: TvSnapshot? {
		if case .paired(let snap) = self { snap } else { nil }
	}
}
