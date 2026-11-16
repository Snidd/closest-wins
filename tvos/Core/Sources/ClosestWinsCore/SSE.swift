import Foundation

/// One line of `/tv/native/stream`. The server writes every event as a single
/// `data: <json>` line followed by an empty line, and `: keep-alive` after 30 s of silence, so
/// a `data:` line is a whole event (`URLSession`'s line sequence drops the empty lines).
public enum SSELine: Equatable, Sendable {
	case event(Data)
	/// A comment (keep-alive): proof the connection is alive, nothing else.
	case comment
	case ignored

	public init(_ line: String) {
		if line.hasPrefix(":") {
			self = .comment
		} else if line.hasPrefix("data:") {
			var payload = line.dropFirst(5)
			if payload.first == " " { payload = payload.dropFirst() }
			self = .event(Data(payload.utf8))
		} else {
			self = .ignored
		}
	}
}
