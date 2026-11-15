/**
 * Number formatting shared by every surface, so the TV, the host and the phones show the same
 * distance for the same guess.
 */

/** Locale-aware distance: metres below 1 km, one decimal below 10 km, whole km above. */
export function formatDistance(km: number, locale: 'en-GB' | 'sv-SE'): string {
	if (km < 1) {
		const m = Math.max(10, Math.round((km * 1000) / 10) * 10);
		return `${new Intl.NumberFormat(locale).format(m)} m`;
	}
	const digits = km < 10 ? 1 : 0;
	const n = new Intl.NumberFormat(locale, {
		minimumFractionDigits: digits,
		maximumFractionDigits: digits
	}).format(km);
	return `${n} km`;
}
