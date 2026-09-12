import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// The real bundles, not a stub `t`. The whole claim under test is that the
// shipped Thai sentence reaches a guest's phone — a mock that echoes keys
// would pass happily while the page rendered `booking.outage.withPhone`.
import '../../../i18n/config';

import PmsOutageNotice from '../PmsOutageNotice';

/**
 * A17 — what a guest is shown when the booking system cannot be reached.
 *
 * The failure this renders is fail-closed by design: no room was held, so
 * the guest is not left thinking they have one. The regression it exists to
 * stop is what they used to see instead — the backend's machine key,
 * `external_service_unavailable`, in a toast.
 */
describe('PmsOutageNotice', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('leads with the Thai sentence and the property desk number', () => {
    vi.stubEnv('VITE_DESK_PHONE_HF', '02 123 4567');

    render(<PmsOutageNotice property="hf" />);

    expect(
      screen.getByText('ระบบจองขัดข้องชั่วคราว กรุณาติดต่อแผนกต้อนรับ โทร 02 123 4567'),
    ).toBeInTheDocument();
  });

  it('puts the English sentence beneath the Thai one, not instead of it', () => {
    vi.stubEnv('VITE_DESK_PHONE_HF', '02 123 4567');

    render(<PmsOutageNotice property="hf" />);

    const notice = screen.getByTestId('pms-outage-notice');
    const text = notice.textContent ?? '';
    const thai = text.indexOf('ระบบจองขัดข้องชั่วคราว');
    const english = text.indexOf('Our booking system is temporarily unavailable');

    expect(thai).toBeGreaterThanOrEqual(0);
    expect(english).toBeGreaterThanOrEqual(0);
    expect(thai).toBeLessThan(english);
  });

  it('never shows the guest the backend error slug', () => {
    vi.stubEnv('VITE_DESK_PHONE_HF', '02 123 4567');

    render(<PmsOutageNotice property="hf" />);

    expect(screen.getByTestId('pms-outage-notice').textContent).not.toContain(
      'external_service_unavailable',
    );
  });

  it('gives each property its own desk number', () => {
    vi.stubEnv('VITE_DESK_PHONE_HF', '02 111 1111');
    vi.stubEnv('VITE_DESK_PHONE_HFVILLE', '02 222 2222');

    const { unmount } = render(<PmsOutageNotice property="hfville" />);
    expect(screen.getByTestId('pms-outage-notice').textContent).toContain('02 222 2222');
    expect(screen.getByTestId('pms-outage-notice').textContent).not.toContain('02 111 1111');
    unmount();

    render(<PmsOutageNotice property="hf" />);
    expect(screen.getByTestId('pms-outage-notice').textContent).toContain('02 111 1111');
  });

  it('makes the number dialable', () => {
    vi.stubEnv('VITE_DESK_PHONE_HF', '02 123 4567');

    render(<PmsOutageNotice property="hf" />);

    // Spaces and dashes stripped — a `tel:` href with spaces in it is not
    // reliably dialable on the old Android WebViews these guests are on.
    expect(screen.getByTestId('pms-outage-desk-phone')).toHaveAttribute(
      'href',
      'tel:021234567',
    );
  });

  /**
   * B16 has not supplied the numbers in every environment, so `deskPhone()`
   * returns null there. The line must degrade to "contact the front desk"
   * rather than disappear: a guest who cannot book always needs some way
   * out, even a vague one.
   */
  it('still points at the desk when no number is configured', () => {
    vi.stubEnv('VITE_DESK_PHONE_HF', '');

    render(<PmsOutageNotice property="hf" />);

    expect(
      screen.getByText('ระบบจองขัดข้องชั่วคราว กรุณาติดต่อแผนกต้อนรับ'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('pms-outage-desk-phone')).not.toBeInTheDocument();
  });

  /**
   * The step this renders on is the one *before* payment, so nothing was
   * taken — and saying so is what stops the guest phoning the desk to ask
   * whether they have been charged twice.
   */
  it('tells the guest nothing was booked and nothing was charged', () => {
    render(<PmsOutageNotice property="hf" />);

    const text = screen.getByTestId('pms-outage-notice').textContent ?? '';
    expect(text).toContain('ยังไม่มีการจองและยังไม่มีการเรียกเก็บเงินจากท่าน');
    expect(text).toContain('No booking was made and you have not been charged.');
  });

  it('announces itself, so a screen reader reaches the guest too', () => {
    render(<PmsOutageNotice property="hf" />);

    expect(screen.getByRole('alert')).toBe(screen.getByTestId('pms-outage-notice'));
  });

  // ==========================================================================
  // A19 — the reason changes what is said
  // ==========================================================================

  /**
   * `channel_disabled` is the PMS saying the channel is switched OFF, not
   * that it fell over. "Temporarily unavailable" invites a guest to sit and
   * retry something that will not come back on its own, so the copy has to
   * say closed.
   */
  it('says the channel is closed, not broken, when the PMS says it is disabled', () => {
    vi.stubEnv('VITE_DESK_PHONE_HF', '02 123 4567');

    render(<PmsOutageNotice property="hf" reason="channel_disabled" />);

    const text = screen.getByTestId('pms-outage-notice').textContent ?? '';
    expect(text).toContain('ขณะนี้ปิดรับจองออนไลน์ กรุณาติดต่อแผนกต้อนรับ โทร 02 123 4567');
    expect(text).toContain('Online booking is closed right now.');
    expect(text).not.toContain('ระบบจองขัดข้องชั่วคราว');
  });

  it('drops the number from the closed copy too when none is configured', () => {
    vi.stubEnv('VITE_DESK_PHONE_HF', '');

    render(<PmsOutageNotice property="hf" reason="channel_disabled" />);

    expect(screen.getByText('ขณะนี้ปิดรับจองออนไลน์ กรุณาติดต่อแผนกต้อนรับ')).toBeInTheDocument();
  });

  /**
   * Every other reason really is "try again shortly" — an unreachable PMS,
   * a rotated token, an inventory lock the backend already spent its retry
   * on — so the default copy stands.
   */
  it.each(['unauthorized', 'inventory_lock_timeout'] as const)(
    'keeps the temporary-outage copy for %s',
    (reason) => {
      vi.stubEnv('VITE_DESK_PHONE_HF', '02 123 4567');

      render(<PmsOutageNotice property="hf" reason={reason} />);

      expect(screen.getByTestId('pms-outage-notice').textContent).toContain(
        'ระบบจองขัดข้องชั่วคราว',
      );
    },
  );
});
