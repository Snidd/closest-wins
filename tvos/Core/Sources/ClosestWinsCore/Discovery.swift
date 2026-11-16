import Foundation
import Network

/// A game server found on the local network. The server advertises `_closestwins._tcp` when it
/// runs with `MDNS_ADVERTISE=1` (`src/lib/server/discovery.ts`; `pnpm dev:lan` turns it on).
public struct DiscoveredServer: Identifiable, Sendable, Equatable {
	/// The Bonjour instance name, e.g. "Closest Wins (studio)".
	public let name: String
	/// The TXT record's `origin`: the server address. Missing when the server only knows itself
	/// by a loopback address; then the address comes from `Discovery.resolve`.
	public let origin: URL?
	let endpoint: NWEndpoint

	public var id: String { name }
}

public enum Discovery {
	public static let serviceType = "_closestwins._tcp"

	/// The servers on the network, again each time the list changes. Browsing stops when the
	/// consumer stops iterating. Finds nothing if the local network permission was denied.
	public static func servers() -> AsyncStream<[DiscoveredServer]> {
		AsyncStream { continuation in
			let browser = NWBrowser(for: .bonjourWithTXTRecord(type: serviceType, domain: nil), using: .tcp)
			browser.browseResultsChangedHandler = { results, _ in
				let servers = results.compactMap { result -> DiscoveredServer? in
					guard case .service(let name, _, _, _) = result.endpoint else { return nil }
					var origin: URL?
					if case .bonjour(let txt) = result.metadata, let text = txt["origin"] {
						origin = serverURL(from: text)
					}
					return DiscoveredServer(name: name, origin: origin, endpoint: result.endpoint)
				}
				continuation.yield(servers.sorted { $0.name < $1.name })
			}
			browser.start(queue: .main)
			continuation.onTermination = { _ in browser.cancel() }
		}
	}

	/// The address of `server`: its advertised origin, otherwise the host and port the service
	/// resolves to (plain HTTP). Nil when it cannot be reached within a few seconds.
	public static func resolve(_ server: DiscoveredServer) async -> URL? {
		if let origin = server.origin { return origin }
		let connection = NWConnection(to: server.endpoint, using: .tcp)
		let stream = AsyncStream<URL?> { continuation in
			connection.stateUpdateHandler = { state in
				switch state {
				case .ready:
					var url: URL?
					if case .hostPort(let host, let port) = connection.currentPath?.remoteEndpoint {
						url = httpURL(host: host, port: port.rawValue)
					}
					continuation.yield(url)
					continuation.finish()
				case .failed, .cancelled:
					continuation.yield(nil)
					continuation.finish()
				default:
					break
				}
			}
			connection.start(queue: .main)
		}
		let timeout = Task {
			try? await Task.sleep(for: .seconds(5))
			connection.cancel()
		}
		defer {
			timeout.cancel()
			connection.cancel()
		}
		for await url in stream { return url }
		return nil
	}

	/// A server address from what a person typed or a TXT record holds: "192.168.1.20:5173",
	/// "http://studio.local:5173/". Plain HTTP unless a scheme is given; any path is dropped.
	public static func serverURL(from text: String) -> URL? {
		let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !trimmed.isEmpty else { return nil }
		let withScheme = trimmed.contains("://") ? trimmed : "http://\(trimmed)"
		guard var parts = URLComponents(string: withScheme),
			let scheme = parts.scheme?.lowercased(), scheme == "http" || scheme == "https",
			let host = parts.host, !host.isEmpty
		else { return nil }
		parts.scheme = scheme
		parts.path = ""
		parts.query = nil
		parts.fragment = nil
		return parts.url
	}

	private static func httpURL(host: NWEndpoint.Host, port: UInt16) -> URL? {
		switch host {
		case .ipv4(let address):
			// Drop the interface suffix ("192.168.1.20%en0").
			return serverURL(from: "\("\(address)".split(separator: "%")[0]):\(port)")
		case .ipv6(let address):
			return serverURL(from: "[\("\(address)".split(separator: "%")[0])]:\(port)")
		case .name(let name, _):
			return serverURL(from: "\(name):\(port)")
		@unknown default:
			return nil
		}
	}
}
