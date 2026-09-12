import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FiAlertCircle, FiPhone } from 'react-icons/fi';
import { Button } from '../ui';
import { deskPhone, deskPhoneHref } from '../../utils/deskContact';
import PmsOutageNotice from './PmsOutageNotice';
import type { Property } from '../../services/channelBookingService';
import type { PmsReason } from '../../utils/pmsReason';

interface BookingErrorNoticeProps {
  /** Which property the guest was trying to book — picks the desk number. */
  property: Property | null;
  /** The PMS's machine reason, or null when it named none. */
  reason: PmsReason | null;
  /** Send the guest back to the dates step. */
  onPickOtherDates: () => void;
}

/**
 * What a guest is shown when the booking channel would not take the hold
 * (A19).
 *
 * One component per *outcome*, chosen by the PMS's own `reason`, because
 * three of the answers arrive as the same HTTP status and want opposite
 * advice:
 *
 * * **`sold_out`** (409) — the dates are the problem. Plain sentence, and a
 *   button back to the dates step; no phone number, because reception cannot
 *   conjure a room that is not there and sending every sold-out guest to the
 *   desk is how a desk stops answering the phone.
 * * **`last_room_held_for_desk`** (409) — the room *exists*, and the guest
 *   can still have it; it is simply not sold through this channel
 *   (new-hotel's `LOYALTY_CHANNEL_LAST_ROOM_FLOOR`). This is the one refusal
 *   where the number is the whole point, so it is a `tel:` link, not text.
 * * **everything else** — `channel_disabled`, `unauthorized`, an inventory
 *   lock the backend already retried, or no reason at all — is
 *   [`PmsOutageNotice`](./PmsOutageNotice), which takes the reason so a
 *   closed channel reads "closed" rather than "temporarily unavailable".
 *
 * Thai first with English beneath throughout, matching every other
 * guest-facing notice in the flow.
 */
export default function BookingErrorNotice({
  property,
  reason,
  onPickOtherDates,
}: BookingErrorNoticeProps) {
  const { i18n } = useTranslation();
  const th = useMemo(() => i18n.getFixedT('th'), [i18n]);
  const en = useMemo(() => i18n.getFixedT('en'), [i18n]);

  const phone = deskPhone(property);

  if (reason === 'sold_out') {
    return (
      <div
        role="alert"
        data-testid="booking-sold-out-notice"
        className="mt-4 flex gap-3 rounded-lg border border-warning-600/30 bg-warning-50 p-4"
      >
        <FiAlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-warning-700" aria-hidden="true" />
        <div className="space-y-2">
          <div className="space-y-1">
            <p className="text-body font-semibold text-warning-700">
              {th('booking.refusal.soldOut.body')}
            </p>
            <p className="text-caption text-ink-muted">{en('booking.refusal.soldOut.body')}</p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onPickOtherDates}
            data-testid="pick-other-dates"
          >
            {th('booking.refusal.soldOut.action')} / {en('booking.refusal.soldOut.action')}
          </Button>
        </div>
      </div>
    );
  }

  if (reason === 'last_room_held_for_desk') {
    const key = phone
      ? 'booking.refusal.deskHeld.withPhone'
      : 'booking.refusal.deskHeld.withoutPhone';
    const options = phone ? { phone } : undefined;
    return (
      <div
        role="alert"
        data-testid="booking-desk-held-notice"
        className="mt-4 flex gap-3 rounded-lg border border-warning-600/30 bg-warning-50 p-4"
      >
        <FiAlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-warning-700" aria-hidden="true" />
        <div className="space-y-1">
          <p className="text-body font-semibold text-warning-700">{th(key, options)}</p>
          <p className="text-caption text-ink-muted">{en(key, options)}</p>
          {phone ? (
            <a
              href={deskPhoneHref(phone)}
              data-testid="desk-held-phone"
              className="inline-flex items-center gap-2 text-body font-semibold text-brand-700 hover:underline"
            >
              <FiPhone className="h-4 w-4" aria-hidden="true" />
              {phone}
            </a>
          ) : null}
        </div>
      </div>
    );
  }

  return <PmsOutageNotice property={property} reason={reason} />;
}
