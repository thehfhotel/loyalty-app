import { logger } from './logger';

/**
 * Times for a desk that is always in Bangkok.
 *
 * `utils/dateFormatter` formats in whatever zone the browser happens to be
 * in, which is right for a member reading their own booking and wrong for
 * reception: a deposit link expires at a wall-clock time someone reads out
 * loud on the phone, and a laptop left on UTC would show a 12:00 expiry as
 * 05:00. Thailand has no DST, so a named zone here is exact rather than an
 * approximation — the same reason the backend pins a fixed +07:00 offset.
 */

export const BANGKOK_TIME_ZONE = 'Asia/Bangkok';

/**
 * `dd/mm/yyyy, hh:mm` in Asia/Bangkok, or `null` for a missing or
 * unparseable value so the caller can render its own dash.
 *
 * `en-GB` picks the numeric day-first layout only; every label around it is
 * translated, the digits are not.
 */
export function formatBangkokDateTime(value: string | Date | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: BANGKOK_TIME_ZONE,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  } catch (error) {
    logger.warn('Could not format a Bangkok timestamp:', error);
    return null;
  }
}

const RELATIVE_UNITS: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number]> = [
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
];

/**
 * "in 3 hours" / "2 days ago", in the reader's language.
 *
 * Zone-independent by construction: an instant minus an instant is the same
 * duration everywhere, which is exactly why this is the line reception acts
 * on and the absolute Bangkok time sits underneath it.
 *
 * `now` is a parameter rather than an internal `Date.now()` so a test can
 * pin it; a phrase computed from the wall clock is otherwise untestable.
 */
export function formatRelativeTime(
  value: string | Date | null | undefined,
  locale: string,
  now: number = Date.now(),
): string | null {
  if (!value) {
    return null;
  }
  const target = (typeof value === 'string' ? new Date(value) : value).getTime();
  if (Number.isNaN(target)) {
    return null;
  }
  const deltaSeconds = Math.round((target - now) / 1000);
  try {
    const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    for (const [unit, seconds] of RELATIVE_UNITS) {
      if (Math.abs(deltaSeconds) >= seconds) {
        return formatter.format(Math.round(deltaSeconds / seconds), unit);
      }
    }
    return formatter.format(deltaSeconds, 'second');
  } catch (error) {
    logger.warn('Could not format a relative time:', error);
    return null;
  }
}
