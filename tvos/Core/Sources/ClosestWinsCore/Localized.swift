import Foundation

/// Content fallback (`src/lib/i18n/localized.ts`): the requested language if filled in,
/// otherwise the other one, otherwise "".
public func localized(sv: String?, en: String?, _ lang: Lang) -> String {
	let (first, second) = lang == .sv ? (sv, en) : (en, sv)
	for text in [first, second] {
		if let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return text }
	}
	return ""
}

extension BilingualName {
	public func name(_ lang: Lang) -> String { localized(sv: nameSv, en: nameEn, lang) }
}

extension Clue {
	public func text(_ lang: Lang) -> String { localized(sv: textSv, en: textEn, lang) }
}

extension RevealTarget {
	public func name(_ lang: Lang) -> String { localized(sv: nameSv, en: nameEn, lang) }
	public func fact(_ lang: Lang) -> String { localized(sv: factSv, en: factEn, lang) }
}
