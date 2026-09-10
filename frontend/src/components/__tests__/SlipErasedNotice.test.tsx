import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Interpolating mock — the date in the message is the whole point of the
// component, so a `t` that dropped the options would let a broken template
// pass.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const templates: Record<string, string> = {
        'payment.slipErased': 'Erased under the retention policy on {{date}}',
        'payment.slipErasedNote': 'The payment record itself is unchanged.',
        'payment.slipUnavailable': 'No slip image',
      };
      const template = templates[key] ?? key;
      return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
        String(opts?.[name] ?? `{{${name}}}`)
      );
    },
  }),
}));

import { SlipErasedNotice } from '../SlipErasedNotice';

describe('SlipErasedNotice', () => {
  it('names the date the image was erased', () => {
    render(<SlipErasedNotice deletedAt="2027-06-01T10:00:00Z" />);

    expect(
      screen.getByText('Erased under the retention policy on 01/06/2027')
    ).toBeInTheDocument();
  });

  it('says the payment record survived, because "the slip is gone" reads as "the evidence is gone"', () => {
    render(<SlipErasedNotice deletedAt="2027-06-01T10:00:00Z" />);

    expect(screen.getByText('The payment record itself is unchanged.')).toBeInTheDocument();
  });

  it('does not claim an erasure for a row that simply never had an image', () => {
    render(<SlipErasedNotice deletedAt={null} />);

    expect(screen.getByText('No slip image')).toBeInTheDocument();
    expect(screen.queryByText(/retention policy/)).not.toBeInTheDocument();
  });

  it('renders no image element at all, so there is nothing to break', () => {
    const { container } = render(<SlipErasedNotice deletedAt="2027-06-01T10:00:00Z" />);

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a[href]')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
  });
});
