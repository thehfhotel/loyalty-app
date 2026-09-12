import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// The real bundles: the claim is that the shipped Thai sentence reaches a
// guest's phone, not that a key was looked up.
import '../../../i18n/config';

import BookingErrorNotice from '../BookingErrorNotice';

/**
 * A19 — what a guest is shown per PMS refusal reason.
 *
 * The reason this component exists at all: `sold_out` and
 * `last_room_held_for_desk` arrive as the **same 409**, and the guest's next
 * step is opposite in each case. A single "booking failed" panel would send
 * a guest who could have had the room by phoning off to change their dates
 * instead — and send every sold-out guest to a reception that cannot help.
 */
describe('BookingErrorNotice', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const noop = () => {};

  // ==========================================================================
  // sold_out — the dates are the problem
  // ==========================================================================

  it('says the room type is full for the chosen dates, Thai first', () => {
    render(<BookingErrorNotice property="hf" reason="sold_out" onPickOtherDates={noop} />);

    const notice = screen.getByTestId('booking-sold-out-notice');
    const text = notice.textContent ?? '';
    const thai = text.indexOf('ห้องประเภทนี้เต็มแล้วสำหรับวันที่เลือก');
    const english = text.indexOf('This room type is fully booked');

    expect(thai).toBeGreaterThanOrEqual(0);
    expect(english).toBeGreaterThanOrEqual(0);
    expect(thai).toBeLessThan(english);
  });

  it('offers the guest a way back to the dates step', async () => {
    const user = userEvent.setup();
    const onPickOtherDates = vi.fn();

    render(
      <BookingErrorNotice property="hf" reason="sold_out" onPickOtherDates={onPickOtherDates} />,
    );

    await user.click(screen.getByTestId('pick-other-dates'));
    expect(onPickOtherDates).toHaveBeenCalledTimes(1);
  });

  /**
   * No phone number on this one, deliberately: reception cannot conjure a
   * room that is not there, and a desk that fields every sold-out guest
   * stops answering the phone for the ones it *can* help.
   */
  it('does not send a sold-out guest to reception', () => {
    vi.stubEnv('VITE_DESK_PHONE_HF', '02 123 4567');

    render(<BookingErrorNotice property="hf" reason="sold_out" onPickOtherDates={noop} />);

    expect(screen.getByTestId('booking-sold-out-notice').textContent).not.toContain('02 123 4567');
  });

  // ==========================================================================
  // last_room_held_for_desk — the room exists, it is just not sold here
  // ==========================================================================

  it('tells the guest the last room is kept for direct booking, with the number', () => {
    vi.stubEnv('VITE_DESK_PHONE_HF', '02 123 4567');

    render(
      <BookingErrorNotice property="hf" reason="last_room_held_for_desk" onPickOtherDates={noop} />,
    );

    expect(
      screen.getByText('ห้องสุดท้ายสำรองไว้สำหรับจองที่โรงแรมโดยตรง กรุณาโทร 02 123 4567'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('booking-desk-held-notice').textContent).toContain(
      'kept for booking with the hotel directly',
    );
  });

  it('makes that number dialable — it is the whole point of this one', () => {
    vi.stubEnv('VITE_DESK_PHONE_HF', '02 123 4567');

    render(
      <BookingErrorNotice property="hf" reason="last_room_held_for_desk" onPickOtherDates={noop} />,
    );

    expect(screen.getByTestId('desk-held-phone')).toHaveAttribute('href', 'tel:021234567');
  });

  it('uses the booked property, not the other one', () => {
    vi.stubEnv('VITE_DESK_PHONE_HF', '02 111 1111');
    vi.stubEnv('VITE_DESK_PHONE_HFVILLE', '02 222 2222');

    render(
      <BookingErrorNotice
        property="hfville"
        reason="last_room_held_for_desk"
        onPickOtherDates={noop}
      />,
    );

    const text = screen.getByTestId('booking-desk-held-notice').textContent ?? '';
    expect(text).toContain('02 222 2222');
    expect(text).not.toContain('02 111 1111');
  });

  it('keeps the sentence when no number is configured', () => {
    vi.stubEnv('VITE_DESK_PHONE_HF', '');

    render(
      <BookingErrorNotice property="hf" reason="last_room_held_for_desk" onPickOtherDates={noop} />,
    );

    expect(
      screen.getByText('ห้องสุดท้ายสำรองไว้สำหรับจองที่โรงแรมโดยตรง กรุณาติดต่อแผนกต้อนรับ'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('desk-held-phone')).not.toBeInTheDocument();
  });

  it('never collapses the two 409s into one another', () => {
    render(
      <BookingErrorNotice property="hf" reason="last_room_held_for_desk" onPickOtherDates={noop} />,
    );

    expect(screen.queryByTestId('booking-sold-out-notice')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pick-other-dates')).not.toBeInTheDocument();
  });

  // ==========================================================================
  // Everything else falls through to the outage notice
  // ==========================================================================

  it('hands a disabled channel to the outage notice, with the reason', () => {
    vi.stubEnv('VITE_DESK_PHONE_HF', '02 123 4567');

    render(
      <BookingErrorNotice property="hf" reason="channel_disabled" onPickOtherDates={noop} />,
    );

    expect(screen.getByTestId('pms-outage-notice').textContent).toContain(
      'ขณะนี้ปิดรับจองออนไลน์',
    );
  });

  it.each(['unauthorized', 'inventory_lock_timeout', 'idempotency_key_mismatch'] as const)(
    'falls through to the outage notice for %s',
    (reason) => {
      render(<BookingErrorNotice property="hf" reason={reason} onPickOtherDates={noop} />);

      expect(screen.getByTestId('pms-outage-notice')).toBeInTheDocument();
    },
  );

  /**
   * A failure the PMS could not put a name to — an unreachable host, a
   * timeout, a token this build does not recognise — is the A17 case,
   * unchanged.
   */
  it('falls through to the outage notice when there is no reason at all', () => {
    render(<BookingErrorNotice property="hf" reason={null} onPickOtherDates={noop} />);

    const notice = screen.getByTestId('pms-outage-notice');
    expect(notice).toBeInTheDocument();
    expect(notice.textContent).toContain('ระบบจองขัดข้องชั่วคราว');
  });

  it('announces every variant, so a screen reader reaches the guest too', () => {
    const { unmount } = render(
      <BookingErrorNotice property="hf" reason="sold_out" onPickOtherDates={noop} />,
    );
    expect(screen.getByRole('alert')).toBe(screen.getByTestId('booking-sold-out-notice'));
    unmount();

    render(
      <BookingErrorNotice property="hf" reason="last_room_held_for_desk" onPickOtherDates={noop} />,
    );
    expect(screen.getByRole('alert')).toBe(screen.getByTestId('booking-desk-held-notice'));
  });
});
