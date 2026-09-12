import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FiPhone } from 'react-icons/fi';
import clsx from 'clsx';
import { deskPhone, deskPhoneHref } from '../../utils/deskContact';
import type { Property } from '../../services/channelBookingService';

const PROPERTIES: Property[] = ['hf', 'hfville'];

interface DeskContactFooterProps {
  /**
   * Which property the guest is dealing with — picks the desk number.
   *
   * `null` where the screen genuinely spans both (the booking list, a
   * deposit link that would not load): every configured desk is listed
   * instead of guessing one, because a guest sent to the wrong property's
   * reception at 02:00 is worse off than one shown two numbers.
   */
  property: Property | null | undefined;
  className?: string;
}

/**
 * The always-there way out of the LIFF booking and payment flow (B16).
 *
 * The in-chat bot is explicitly out of scope for this programme, so a Thai
 * guest who gets stuck at 22:00 — a QR that will not scan, a slip the app
 * will not take, a hold counting down — has nowhere to go unless every
 * screen carries the desk number. Reception answers around the clock (owner,
 * 2026-09-11), so the line says so: an unqualified "contact reception" on a
 * screen a guest is reading at midnight is worse than no line at all,
 * because they assume it is shut.
 *
 * **Persistent, not conditional.** `PmsOutageNotice` and the refusal
 * notices appear when something has gone wrong; this appears whether or not
 * it has. The two are not redundant — the notices say *what happened*, this
 * says *who to call*, and a guest who simply cannot work the page has hit
 * no error at all.
 *
 * Thai first, English beneath, regardless of the UI language the guest
 * picked: the desk answers in Thai, and this is the line that gets read
 * aloud. Same `deskPhone()` source as every other desk line in the app, so
 * the number cannot drift between screens; when `VITE_DESK_PHONE_*` is
 * unset the copy drops the number rather than the whole line.
 */
export default function DeskContactFooter({ property, className }: DeskContactFooterProps) {
  const { i18n } = useTranslation();
  const th = useMemo(() => i18n.getFixedT('th'), [i18n]);
  const en = useMemo(() => i18n.getFixedT('en'), [i18n]);

  const phone = property ? deskPhone(property) : null;
  const everyDesk = useMemo(
    () =>
      property
        ? []
        : PROPERTIES.map((p) => ({ property: p, phone: deskPhone(p) })).filter(
            (d): d is { property: Property; phone: string } => d.phone !== null,
          ),
    [property],
  );

  const wrapper = (children: React.ReactNode) => (
    <div
      className={clsx('space-y-1 border-t border-hairline pt-4', className)}
      data-testid="desk-contact-footer"
    >
      {children}
    </div>
  );

  if (phone) {
    const options = { phone };
    return wrapper(
      <>
        <a
          href={deskPhoneHref(phone)}
          className="inline-flex items-center gap-2 text-body text-brand-700 hover:underline"
          data-testid="desk-phone"
        >
          <FiPhone className="h-4 w-4" aria-hidden="true" />
          {th('desk.footer.withPhone', options)}
        </a>
        <p className="text-caption text-ink-muted">{en('desk.footer.withPhone', options)}</p>
      </>,
    );
  }

  if (everyDesk.length > 0) {
    return wrapper(
      <>
        <p className="text-body text-ink">{th('desk.footer.anyProperty')}</p>
        {everyDesk.map((desk) => (
          <a
            key={desk.property}
            href={deskPhoneHref(desk.phone)}
            className="flex items-center gap-2 text-body text-brand-700 hover:underline"
            data-testid={`desk-phone-${desk.property}`}
          >
            <FiPhone className="h-4 w-4" aria-hidden="true" />
            {th(`property.${desk.property}`)} {desk.phone}
          </a>
        ))}
        <p className="text-caption text-ink-muted">{en('desk.footer.anyProperty')}</p>
      </>,
    );
  }

  // Nothing configured anywhere. The line still ships: a guest who cannot
  // finish a booking always needs *some* way out, even a vague one.
  return wrapper(
    <>
      <p className="text-body text-ink-muted" data-testid="desk-phone">
        {th('desk.footer.withoutPhone')}
      </p>
      <p className="text-caption text-ink-muted">{en('desk.footer.withoutPhone')}</p>
    </>,
  );
}
