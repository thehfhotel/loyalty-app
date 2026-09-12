import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

/**
 * The public PDPA notice (/privacy, task F3).
 *
 * What these tests are for: the notice is a legal document whose *shape* is
 * the compliance property — the slip card, the retention list marked as
 * proposals, the 72-hour breach sentence and a contact that is never blank.
 * A refactor that quietly drops a card would be invisible to typecheck and
 * is exactly what a regulator would notice, so each of those is an
 * assertion.
 *
 * `t()` echoes the key, and echoes `key@en` when asked for the English
 * bundle, so the assertions pin key names rather than copy — the copy is
 * expected to be edited by the owner and the lawyer.
 */

let mockLanguage = 'th';
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { lng?: string }) =>
      options?.lng === 'en' ? `${key}@en` : key,
    i18n: {
      get language() {
        return mockLanguage;
      },
    },
  }),
}));

vi.mock('../../components/layout/AppShell', () => ({
  default: ({ children, title }: { children: React.ReactNode; title: string }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));

import PrivacyPage from '../PrivacyPage';

function renderPage() {
  return render(
    <MemoryRouter>
      <PrivacyPage />
    </MemoryRouter>,
  );
}

describe('PrivacyPage', () => {
  beforeEach(() => {
    mockLanguage = 'th';
    vi.stubEnv('VITE_PDPA_CONTACT_EMAIL', '');
    vi.stubEnv('VITE_DESK_PHONE_HF', '');
    vi.stubEnv('VITE_DESK_PHONE_HFVILLE', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('renders every card the data map requires', () => {
    renderPage();
    // The four original cards.
    expect(screen.getAllByText('privacy.whatWeStoreTitle').length).toBeGreaterThan(0);
    expect(screen.getAllByText('privacy.whyTitle').length).toBeGreaterThan(0);
    expect(screen.getAllByText('privacy.messagesTitle').length).toBeGreaterThan(0);
    expect(screen.getAllByText('privacy.contactTitle').length).toBeGreaterThan(0);
    // The four F3 adds.
    expect(screen.getAllByText('privacy.slipTitle').length).toBeGreaterThan(0);
    expect(screen.getAllByText('privacy.retentionTitle').length).toBeGreaterThan(0);
    expect(screen.getAllByText('privacy.rightsTitle').length).toBeGreaterThan(0);
    expect(screen.getAllByText('privacy.breachTitle').length).toBeGreaterThan(0);
  });

  it('says the slip may show a third party and that images are excluded from an export', () => {
    renderPage();
    // Six sentences, from F1 §9. slipBody1 is the third-party sentence and
    // slipBody6 is the one that tells a payer how to reach us.
    for (const n of [1, 2, 3, 4, 5, 6]) {
      expect(screen.getAllByText(`privacy.slipBody${n}`).length).toBeGreaterThan(0);
    }
  });

  it('marks the retention periods as proposals and lists every one of them', () => {
    renderPage();
    expect(screen.getAllByText('privacy.retentionProposalNote').length).toBeGreaterThan(0);
    for (const key of [
      'privacy.retentionSlipImage',
      'privacy.retentionSlipMeta',
      'privacy.retentionBooking',
      'privacy.retentionMembership',
      'privacy.retentionSurvey',
      'privacy.retentionLine',
      'privacy.retentionNotify',
    ]) {
      expect(screen.getAllByText(key).length).toBeGreaterThan(0);
    }
    // The audit floors and the backup caveat are not proposals — they are
    // implemented, and the notice must not blur the two.
    expect(screen.getAllByText('privacy.retentionAudit').length).toBeGreaterThan(0);
    expect(screen.getAllByText('privacy.retentionBackup').length).toBeGreaterThan(0);
  });

  it('carries the 72-hour breach statement', () => {
    renderPage();
    expect(screen.getAllByText('privacy.breachBody').length).toBeGreaterThan(0);
  });

  it('names the configured PDPA contact when one is set', () => {
    vi.stubEnv('VITE_PDPA_CONTACT_EMAIL', 'privacy@thehfhotel.org');
    renderPage();
    const links = screen.getAllByTestId('pdpa-contact-email');
    expect(links[0]).toHaveTextContent('privacy@thehfhotel.org');
    expect(links[0]).toHaveAttribute('href', 'mailto:privacy@thehfhotel.org');
    expect(screen.queryByTestId('pdpa-contact-fallback')).toBeNull();
  });

  it('falls back to the desk rather than rendering an empty contact section', () => {
    // The one failure mode that turns a legal obligation into a broken
    // page: a blank variable must still leave the guest a way to ask.
    vi.stubEnv('VITE_PDPA_CONTACT_EMAIL', '   ');
    vi.stubEnv('VITE_DESK_PHONE_HF', '02 123 4567');
    renderPage();
    expect(screen.getAllByTestId('pdpa-contact-fallback').length).toBeGreaterThan(0);
    expect(screen.getAllByText('privacy.contactDesk').length).toBeGreaterThan(0);
    expect(screen.getAllByText('02 123 4567').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('pdpa-contact-email')).toBeNull();
  });

  it('appends an English section for a Thai reader', () => {
    mockLanguage = 'th';
    renderPage();
    expect(screen.getByTestId('privacy-english-heading')).toBeInTheDocument();
    // Pulled from the `en` bundle, not the active one.
    expect(screen.getByText('privacy.slipBody1@en')).toBeInTheDocument();
    expect(screen.getByText('privacy.breachBody@en')).toBeInTheDocument();
  });

  it('appends an English section for a Chinese reader too', () => {
    mockLanguage = 'zh-CN';
    renderPage();
    expect(screen.getByTestId('privacy-english-heading')).toBeInTheDocument();
    expect(screen.getByText('privacy.retentionProposalNote@en')).toBeInTheDocument();
  });

  it('does not repeat itself in English for an English reader', () => {
    mockLanguage = 'en';
    renderPage();
    expect(screen.queryByTestId('privacy-english-heading')).toBeNull();
    expect(screen.queryByText('privacy.slipBody1@en')).toBeNull();
    // The notice itself is still fully there.
    expect(screen.getByText('privacy.slipBody1')).toBeInTheDocument();
  });

  it('keeps a link back to the app', () => {
    renderPage();
    expect(screen.getByText('privacy.backToApp')).toBeInTheDocument();
  });
});
