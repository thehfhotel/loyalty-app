import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FiAlertCircle, FiPhone } from 'react-icons/fi';
import { deskPhone, deskPhoneHref } from '../../utils/deskContact';
import type { Property } from '../../services/channelBookingService';
import type { PmsReason } from '../../utils/pmsReason';

interface PmsOutageNoticeProps {
  /** Which property the guest was trying to book — picks the desk number. */
  property: Property | null;
  /**
   * The PMS's own machine reason, when it sent one (A19).
   *
   * Only `channel_disabled` changes what is said, and it changes it
   * materially: the channel being switched off is not an outage, and
   * "temporarily unavailable" invites a guest to sit and retry something
   * that will not come back on its own. Every other reason — an unreachable
   * PMS, a rotated token, an inventory lock this client already retried —
   * really is "try again shortly", which is what the default copy says.
   */
  reason?: PmsReason | null;
}

/**
 * What a guest sees when the booking system could not be reached (A17).
 *
 * The hold create **fails closed**: rather than pretend a room is held, the
 * backend refuses. Before this existed the guest was shown the backend's
 * machine key — the literal string `external_service_unavailable`, in a
 * toast — which tells a person nothing, in a language they may not read,
 * about a situation where there is in fact something they can do.
 *
 * So: the sentence first, in Thai, with the desk number for the property
 * they were booking, and English beneath it. Same shape and the same
 * `deskPhone()` source as `DepositLinkPage` — a guest stuck on a payment
 * page and a guest stuck on a booking page need exactly the same way out,
 * and the number should not be able to drift between the two.
 *
 * **Thai first is not a default-language question.** This is rendered
 * regardless of the UI language the guest picked, because the desk answers
 * in Thai and the person who will end up reading this line aloud to a
 * colleague is usually Thai. English sits beneath it for everyone else,
 * which is also what the deposit-link pages do.
 *
 * When `VITE_DESK_PHONE_*` is unset (B16 has not supplied the numbers in
 * every environment yet) `deskPhone()` returns null and the copy drops the
 * number rather than the whole line — a guest who cannot book always needs
 * *some* way out, even a vague one.
 */
export default function PmsOutageNotice({ property, reason = null }: PmsOutageNoticeProps) {
  const { i18n } = useTranslation();
  const th = useMemo(() => i18n.getFixedT('th'), [i18n]);
  const en = useMemo(() => i18n.getFixedT('en'), [i18n]);

  const phone = deskPhone(property);
  const closed = reason === 'channel_disabled';
  const key = closed
    ? phone
      ? 'booking.outage.closedWithPhone'
      : 'booking.outage.closedWithoutPhone'
    : phone
      ? 'booking.outage.withPhone'
      : 'booking.outage.withoutPhone';
  const options = phone ? { phone } : undefined;

  return (
    <div
      role="alert"
      data-testid="pms-outage-notice"
      data-reason={reason ?? undefined}
      className="mt-4 flex gap-3 rounded-lg border border-warning-600/30 bg-warning-50 p-4"
    >
      <FiAlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-warning-700" aria-hidden="true" />
      <div className="space-y-1">
        <p className="text-body font-semibold text-warning-700">{th(key, options)}</p>
        <p className="text-caption text-ink-muted">{en(key, options)}</p>
        {phone ? (
          <a
            href={deskPhoneHref(phone)}
            data-testid="pms-outage-desk-phone"
            className="inline-flex items-center gap-2 text-body font-semibold text-brand-700 hover:underline"
          >
            <FiPhone className="h-4 w-4" aria-hidden="true" />
            {phone}
          </a>
        ) : null}
        <p className="text-caption text-ink-muted">
          {th('booking.outage.notCharged')} / {en('booking.outage.notCharged')}
        </p>
      </div>
    </div>
  );
}
