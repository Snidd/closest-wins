import Foundation

/// Reveal choreography (`src/lib/map/reveal.ts`), driven only by server timestamps so the TV
/// and the phones show the same stage at the same moment:
///
///     revealStartedAt ─ pins ─▶ answerVisibleAt ─ flying ─▶ +flyMs ─ lines ─▶ +linesMs ─ done
///
/// - `pins`: the guesses appear on the map one by one (each at its `revealAt`), then a hold;
///   the answer is still hidden.
/// - `flying`: the target drops in and the camera flies to it.
/// - `lines`: lines grow from each guess to the target and the distances count up; name, fact
///   and photo credit appear.
/// - `done`: winner and ranking.
///
/// A skipped reveal is `done` at once.
public enum RevealStage: Int, Sendable, Comparable, CaseIterable {
	case pins, flying, lines, done

	public static func < (a: RevealStage, b: RevealStage) -> Bool { a.rawValue < b.rawValue }
}

public struct RevealTiming: Sendable, Equatable {
	public let stage: RevealStage
	/// 0...1 within the stage (1 for `done`).
	public let progress: Double
	/// Server time the stage started and ends (`.infinity` for `done`).
	public let startsAt: EpochMs
	public let endsAt: EpochMs

	public init(_ r: RoundResult, now: EpochMs, flyMs: Double, linesMs: Double) {
		self.init(
			revealStartedAt: r.revealStartedAt, answerVisibleAt: r.answerVisibleAt, skipped: r.skipped,
			now: now, flyMs: flyMs, linesMs: linesMs
		)
	}

	public init(revealStartedAt: EpochMs, answerVisibleAt: EpochMs, skipped: Bool, now: EpochMs, flyMs: Double, linesMs: Double) {
		if skipped {
			(stage, progress, startsAt, endsAt) = (.done, 1, revealStartedAt, .infinity)
			return
		}
		let flyAt = answerVisibleAt
		let linesAt = flyAt + flyMs
		let doneAt = linesAt + linesMs
		func frac(_ a: Double, _ b: Double) -> Double { b > a ? min(1, max(0, (now - a) / (b - a))) : 1 }
		if now < flyAt {
			(stage, progress, startsAt, endsAt) = (.pins, frac(revealStartedAt, flyAt), revealStartedAt, flyAt)
		} else if now < linesAt {
			(stage, progress, startsAt, endsAt) = (.flying, frac(flyAt, linesAt), flyAt, linesAt)
		} else if now < doneAt {
			(stage, progress, startsAt, endsAt) = (.lines, frac(linesAt, doneAt), linesAt, doneAt)
		} else {
			(stage, progress, startsAt, endsAt) = (.done, 1, doneAt, .infinity)
		}
	}
}
