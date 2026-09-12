import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// The real bundles: the claim under test is that the shipped Thai sentence
// reaches a guest's phone, which a key-echoing stub would pass vacuously.
import '../../../i18n/config';

import DeskContactFooter from '../DeskContactFooter';

/**
 * B16 — the persistent call-the-desk line on every booking and payment
 * screen in the LIFF flow.
 *
 * The in-chat bot is out of scope for the programme, so this line is the
 * *whole* support path for a guest stuck at 22:00. The two things it must
 * never do: disappear because no number is configured, and imply reception
 * is shut.
 */
describe('DeskContactFooter', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('leads with the Thai line, the number, and the 24-hour promise', () => {
    vi.stubEnv('VITE_DESK_PHONE_HF', '02 123 4567');

    render(<DeskContactFooter property="hf" />);

    expect(
      screen.getByText('ติดต่อแผนกต้อนรับ โทร 02 123 4567 (ตลอด 24 ชั่วโมง)'),
    ).toBeInTheDocument();
  });

  it('puts English beneath the Thai, not instead of it', () => {
    vi.stubEnv('VITE_DESK_PHONE_HF', '02 123 4567');

    render(<DeskContactFooter property="hf" />);

    const text = screen.getByTestId('desk-contact-footer').textContent ?? '';
    const thai = text.indexOf('ติดต่อแผนกต้อนรับ');
    const english = text.indexOf('Contact the front desk on');

    expect(thai).toBeGreaterThanOrEqual(0);
    expect(english).toBeGreaterThanOrEqual(0);
    expect(thai).toBeLessThan(english);
    expect(text).toContain('open 24 hours');
  });

  it('makes the number dialable with the spaces stripped', () => {
    vi.stubEnv('VITE_DESK_PHONE_HF', '02 123 4567');

    render(<DeskContactFooter property="hf" />);

    expect(screen.getByTestId('desk-phone')).toHaveAttribute('href', 'tel:021234567');
  });

  it('gives each property its own desk number', () => {
    vi.stubEnv('VITE_DESK_PHONE_HF', '02 111 1111');
    vi.stubEnv('VITE_DESK_PHONE_HFVILLE', '02 222 2222');

    const { unmount } = render(<DeskContactFooter property="hfville" />);
    expect(screen.getByTestId('desk-contact-footer').textContent).toContain('02 222 2222');
    expect(screen.getByTestId('desk-contact-footer').textContent).not.toContain('02 111 1111');
    unmount();

    render(<DeskContactFooter property="hf" />);
    expect(screen.getByTestId('desk-contact-footer').textContent).toContain('02 111 1111');
  });

  /**
   * The booking list spans both properties and does not know which one a
   * given screen is about. Listing both desks beats guessing one: a guest
   * sent to the wrong property's reception at 02:00 is worse off than a
   * guest shown two numbers.
   */
  it('lists every desk when the screen does not know the property', () => {
    vi.stubEnv('VITE_DESK_PHONE_HF', '02 111 1111');
    vi.stubEnv('VITE_DESK_PHONE_HFVILLE', '02 222 2222');

    render(<DeskContactFooter property={null} />);

    expect(screen.getByTestId('desk-phone-hf')).toHaveAttribute('href', 'tel:021111111');
    expect(screen.getByTestId('desk-phone-hfville')).toHaveAttribute('href', 'tel:022222222');
    expect(screen.getByTestId('desk-contact-footer').textContent).toContain('ตลอด 24 ชั่วโมง');
  });

  /**
   * `VITE_DESK_PHONE_*` is a build-time substitution, filled in CI from the
   * `DESK_PHONE_*` repository variables. A build without them — local, a
   * preview — must degrade the line, not lose it.
   */
  it('still points at the desk when no number is configured anywhere', () => {
    vi.stubEnv('VITE_DESK_PHONE_HF', '');
    vi.stubEnv('VITE_DESK_PHONE_HFVILLE', '');

    render(<DeskContactFooter property="hf" />);

    expect(
      screen.getByText('กรุณาติดต่อแผนกต้อนรับของโรงแรมที่ท่านจอง (ตลอด 24 ชั่วโมง)'),
    ).toBeInTheDocument();
  });

  it('degrades the unknown-property case the same way', () => {
    vi.stubEnv('VITE_DESK_PHONE_HF', '');
    vi.stubEnv('VITE_DESK_PHONE_HFVILLE', '');

    render(<DeskContactFooter property={null} />);

    expect(screen.getByTestId('desk-contact-footer')).toBeInTheDocument();
    expect(screen.queryByTestId('desk-phone-hf')).not.toBeInTheDocument();
    expect(screen.getByTestId('desk-contact-footer').textContent).toContain('ตลอด 24 ชั่วโมง');
  });
});
