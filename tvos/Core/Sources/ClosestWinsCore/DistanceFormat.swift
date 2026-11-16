import Foundation

/// The web's `formatDistance` (`src/lib/i18n/format.ts`); the rule and the samples every client
/// must reproduce are in `shared.json` under `distanceFormat`.
///
/// Below 1 km: metres to the nearest 10, at least 10. Below 10 km: one decimal. Otherwise whole
/// kilometres. Rounding is half away from zero (3.25 → 3.3), which is why this does not use
/// `NumberFormatter` (half to even by default).
public func formatDistance(_ km: Double, _ lang: Lang) -> String {
	if km < 1 {
		let metres = max(10, ((km * 1000) / 10).rounded(.toNearestOrAwayFromZero) * 10)
		return "\(grouped(String(Int(metres)), lang)) m"
	}
	let digits = km < 10 ? 1 : 0
	// Round the shortest decimal form of the number, as the browser does: 3.25 is stored as
	// slightly less than 3.25 in binary and would otherwise round down.
	var value = Decimal(string: "\(km)") ?? Decimal(km)
	var rounded = Decimal()
	NSDecimalRound(&rounded, &value, digits, .plain)
	let parts = NSDecimalString(&rounded, Foundation.Locale(identifier: "en_US_POSIX")).split(separator: ".", omittingEmptySubsequences: false)
	var text = grouped(String(parts[0]), lang)
	if digits > 0 {
		let fraction = parts.count > 1 ? String(parts[1]) : ""
		text += (lang == .sv ? "," : ".") + fraction.padding(toLength: digits, withPad: "0", startingAt: 0)
	}
	return "\(text) km"
}

/// Thousands grouping of a string of digits: sv-SE uses a no-break space, en-GB a comma.
private func grouped(_ digits: String, _ lang: Lang) -> String {
	let separator = lang == .sv ? "\u{00A0}" : ","
	var out = ""
	for (i, ch) in digits.enumerated() {
		if i > 0, (digits.count - i) % 3 == 0 { out += separator }
		out.append(ch)
	}
	return out
}
