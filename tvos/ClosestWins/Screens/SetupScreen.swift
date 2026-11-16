import ClosestWinsCore
import SwiftUI

/// Strings of the Setup screen. The web TV has no such screen (a browser already knows its
/// server), so these are not in `shared.json`.
struct SetupStrings {
	let title: String
	let searching: String
	let found: String
	let addressLabel: String
	let connect: String
	let invalid: String
	let unreachable: String
	let hint: String
	let changeServer: String

	static func of(_ lang: Lang) -> SetupStrings {
		switch lang {
		case .en:
			SetupStrings(
				title: "Find the game",
				searching: "Looking for the game server on your network…",
				found: "On your network",
				addressLabel: "Or type the server address",
				connect: "Connect",
				invalid: "That does not look like an address. Example: 192.168.1.20:5173",
				unreachable: "Could not reach that server",
				hint: "The address is shown when the server starts.",
				changeServer: "Change server"
			)
		case .sv:
			SetupStrings(
				title: "Hitta spelet",
				searching: "Letar efter spelservern i ditt nätverk…",
				found: "I ditt nätverk",
				addressLabel: "Eller skriv serverns adress",
				connect: "Anslut",
				invalid: "Det ser inte ut som en adress. Exempel: 192.168.1.20:5173",
				unreachable: "Kunde inte nå den servern",
				hint: "Adressen visas när servern startar.",
				changeServer: "Byt server"
			)
		}
	}
}

/// Choosing the game server: found over Bonjour, or typed once. The choice is remembered.
struct SetupScreen: View {
	@Environment(AppModel.self) private var model
	@State private var servers: [DiscoveredServer] = []
	@State private var address = ""
	@State private var problem: String?
	/// The server button the remote is on.
	@FocusState private var focusedServer: String?

	var body: some View {
		let s = SetupStrings.of(model.lang)
		VStack(spacing: rem(1.6)) {
			Logo(size: 2.6)
			Text(s.title).font(.rem(2.4, .black))

			VStack(spacing: rem(0.6)) {
				if servers.isEmpty {
					HStack(spacing: rem(0.7)) {
						ProgressView()
						Text(s.searching).font(.rem(1.15)).foregroundStyle(Theme.ink2)
					}
					.frame(height: rem(3))
				} else {
					Eyebrow(text: s.found, size: 0.9)
					ForEach(servers) { server in
						Button {
							Task { await choose(server, s) }
						} label: {
							VStack(spacing: 2) {
								Text(server.name).font(.rem(1.2, .bold))
								if let origin = server.origin {
									Text(origin.absoluteString).font(.rem(0.85)).opacity(0.7)
								}
							}
							.frame(width: rem(24))
						}
						.buttonStyle(TvButtonStyle())
						.focused($focusedServer, equals: server.id)
					}
				}
			}
			.padding(.top, rem(0.6))

			VStack(spacing: rem(0.6)) {
				Text(s.addressLabel).font(.rem(1)).foregroundStyle(Theme.ink2)
				HStack(spacing: rem(0.8)) {
					TextField("192.168.1.20:5173", text: $address)
						.keyboardType(.URL)
						.autocorrectionDisabled()
						.textInputAutocapitalization(.never)
						.frame(width: rem(20))
						.onSubmit { connectTyped(s) }
					Button(s.connect) { connectTyped(s) }
						.font(.rem(1.1, .bold))
						.buttonStyle(TvButtonStyle())
						.disabled(address.trimmingCharacters(in: .whitespaces).isEmpty)
				}
				Text(problem ?? s.hint)
					.font(.rem(0.9))
					.foregroundStyle(problem == nil ? Theme.ink3 : Theme.urgent)
			}
			.padding(.top, rem(1))
		}
		.task {
			for await found in Discovery.servers() {
				// The first server found takes the focus, so one press on the remote connects.
				let first = servers.isEmpty && address.isEmpty ? found.first : nil
				servers = found
				if let first { focusedServer = first.id }
			}
		}
	}

	private func choose(_ server: DiscoveredServer, _ s: SetupStrings) async {
		if let url = await Discovery.resolve(server) {
			model.connect(to: url)
		} else {
			problem = s.unreachable
		}
	}

	private func connectTyped(_ s: SetupStrings) {
		if let url = Discovery.serverURL(from: address) {
			model.connect(to: url)
		} else {
			problem = s.invalid
		}
	}
}
