import Foundation

// `shared.json`, generated on the server side by `pnpm tvos:export`: the strings in both
// languages and the constants the app shares with the web. Never edit that file by hand.

/// An argument of a message: a count, or text that is already formatted (a distance).
public enum MessageArg: Sendable, Equatable, ExpressibleByIntegerLiteral, ExpressibleByStringLiteral {
	case int(Int)
	case text(String)

	public init(integerLiteral value: Int) { self = .int(value) }
	public init(stringLiteral value: String) { self = .text(value) }

	var rendered: String {
		switch self {
		case .int(let n): String(n)
		case .text(let s): s
		}
	}
}

public enum Message: Decodable, Sendable, Equatable {
	case plain(String)
	/// `{name}` placeholders; the first case whose `when` values all equal the arguments wins.
	case template(String, cases: [Case])
	/// `common.km`: the distance rule in `DistanceFormat.swift`.
	case distance

	public struct Case: Decodable, Sendable, Equatable {
		public let when: [String: Int]
		public let template: String
	}

	private enum Keys: String, CodingKey { case template, cases, format }

	public init(from decoder: Decoder) throws {
		if let plain = try? decoder.singleValueContainer().decode(String.self) {
			self = .plain(plain)
			return
		}
		let c = try decoder.container(keyedBy: Keys.self)
		if let format = try c.decodeIfPresent(String.self, forKey: .format) {
			guard format == "distance" else {
				throw DecodingError.dataCorruptedError(forKey: .format, in: c, debugDescription: "Unknown format \(format)")
			}
			self = .distance
			return
		}
		self = .template(
			try c.decode(String.self, forKey: .template),
			cases: try c.decodeIfPresent([Case].self, forKey: .cases) ?? []
		)
	}

	public func render(_ args: [String: MessageArg] = [:]) -> String {
		switch self {
		case .plain(let text):
			return text
		case .distance:
			return args["km"]?.rendered ?? ""
		case .template(let template, let cases):
			let match = cases.first { c in c.when.allSatisfy { args[$0.key] == .int($0.value) } }
			var text = match?.template ?? template
			for (name, value) in args {
				text = text.replacingOccurrences(of: "{\(name)}", with: value.rendered)
			}
			return text
		}
	}
}

public struct Shared: Decodable, Sendable {
	public enum Dict: String, Sendable { case common, tv }

	public struct PlayerColor: Decodable, Sendable {
		public let hex: String
		/// `#000000` or `#ffffff`: the readable text colour on `hex`.
		public let text: String
	}

	public struct Reveal: Decodable, Sendable {
		public let flyMs: Double
		public let linesMs: Double
	}

	public struct WorldView: Decodable, Sendable {
		public let lng: Double
		public let lat: Double
		public let zoom: Double
	}

	public struct Map: Decodable, Sendable {
		public let worldView: WorldView
	}

	public struct Game: Decodable, Sendable {
		public let joinCodeLength: Int
		public let maxPlayers: Int
	}

	public struct Pairing: Decodable, Sendable {
		public let codeLength: Int
	}

	public struct DistanceExample: Decodable, Sendable {
		public let km: Double
		public let text: String
	}

	public struct DistanceFormat: Decodable, Sendable {
		public let examples: [String: [DistanceExample]]
	}

	public let version: Int
	/// `strings[dict][lang][key]`.
	public let strings: [String: [String: [String: Message]]]
	public let distanceFormat: DistanceFormat
	public let playerColors: [PlayerColor]
	public let reveal: Reveal
	public let map: Map
	public let pairing: Pairing
	public let game: Game

	public static func load(from url: URL) throws -> Shared {
		try JSONDecoder().decode(Shared.self, from: Data(contentsOf: url))
	}

	public func message(_ dict: Dict, _ key: String, _ lang: Lang) -> Message? {
		strings[dict.rawValue]?[lang.rawValue]?[key]
	}

	/// Black or white, whichever reads on the player colour `hex`.
	public func textColor(on hex: String) -> String {
		playerColors.first { $0.hex.caseInsensitiveCompare(hex) == .orderedSame }?.text ?? "#000000"
	}
}

/// The strings of one language: `t.tv("standings")`, `t.common("roundOf", ["n": 1, "total": 5])`.
public struct Strings: Sendable {
	public let shared: Shared
	public let lang: Lang

	public init(_ shared: Shared, _ lang: Lang) {
		self.shared = shared
		self.lang = lang
	}

	public func tv(_ key: String, _ args: [String: MessageArg] = [:]) -> String {
		text(.tv, key, args)
	}

	public func common(_ key: String, _ args: [String: MessageArg] = [:]) -> String {
		text(.common, key, args)
	}

	/// A distance in this language: "420 m", "3,3 km", "1 234 km".
	public func km(_ km: Double) -> String {
		formatDistance(km, lang)
	}

	private func text(_ dict: Shared.Dict, _ key: String, _ args: [String: MessageArg]) -> String {
		guard let message = shared.message(dict, key, lang) else {
			assertionFailure("No string \(dict.rawValue).\(key)")
			return key
		}
		return message.render(args)
	}
}
