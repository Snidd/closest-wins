import Foundation

/// The language the app shows: `forced` if set, otherwise the game's language once paired,
/// otherwise Swedish if the device's first preferred language is Swedish, else English.
public func displayLanguage(forced: Lang?, game: Lang?, preferredLanguages: [String]) -> Lang {
	if let forced { return forced }
	if let game { return game }
	return preferredLanguages.first?.hasPrefix("sv") == true ? .sv : .en
}
