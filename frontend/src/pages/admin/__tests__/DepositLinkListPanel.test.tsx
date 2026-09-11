import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// The real i18n bundles. The desk reads Thai, and "does the Thai label for
// this state exist" is exactly what this panel has to get right.
import '../../../i18n/config';

const { mockListLinks, mockRevokeLink, mockReissueLink } = vi.hoisted(() => ({
  mockListLinks: vi.fn(),
  mockRevokeLink: vi.fn(),
  mockReissueLink: vi.fn(),
}));

vi.mock('../../../services/depositLinkService', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../services/depositLinkService')>();
  return {
    ...actual,
    depositLinkService: {
      listLinks: mockListLinks,
      revokeLink: mockRevokeLink,
      reissueLink: mockReissueLink,
    },
  };
});

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
  default: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

import DepositLinkListPanel from '../DepositLinkListPanel';
import type {
  DepositLinkListItem,
  DepositLinkState,
  IssuedDepositLink,
} from '../../../services/depositLinkService';

const OLD_TOKEN = 'a'.repeat(43);
const NEW_TOKEN = 'b'.repeat(43);

function row(overrides: Partial<DepositLinkListItem> = {}): DepositLinkListItem {
  return {
    linkId: 'link-1',
    bookingId: 'booking-1',
    property: 'hf',
    guestName: 'Somchai Sooksan',
    // Written the way reception says it out loud, not the way it is stored:
    // the search has to survive the separators on both sides.
    guestPhone: '081-234-5678',
    amountDueNow: 1500,
    state: 'awaiting_payment',
    // 2026-10-01 05:00Z is 12:00 in Bangkok — a deliberate cross-noon
    // instant, so a panel formatting in UTC would read 05:00 and fail.
    expiresAt: '2026-10-01T05:00:00.000Z',
    issuedByName: 'Reception A',
    issuedAt: '2026-09-29T03:00:00.000Z',
    lastOpenedAt: null,
    slipokStatus: null,
    ...overrides,
  };
}

const EVERY_STATE: DepositLinkState[] = [
  'awaiting_payment',
  'checking',
  'confirmed',
  'expired',
  'revoked',
];

/**
 * `userEvent.setup()` installs its own `navigator.clipboard` stub, so a spy
 * planted in `beforeEach` is gone by the time the test clicks anything.
 * Plant it *after* setup instead.
 */
function installClipboardSpy() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    writable: true,
    value: { writeText },
  });
  return writeText;
}

/**
 * The Table renders a desktop row and a mobile card for every link, so each
 * test id is in the DOM twice; they are the same control at two
 * breakpoints. Take the first, and fail loudly rather than `undefined`.
 */
function action(testId: string): HTMLElement {
  const [element] = screen.getAllByTestId(testId);
  if (!element) {
    throw new Error(`expected at least one element with data-testid=${testId}`);
  }
  return element;
}

/**
 * Reissue is confirmed like revoke — it revokes every live link on the
 * booking — so every reissue in this file goes through the dialog.
 */
async function reissueThroughDialog(
  user: ReturnType<typeof userEvent.setup>,
  testId: string,
) {
  await user.click(action(testId));
  const dialog = await screen.findByRole('dialog');
  await user.click(within(dialog).getByTestId('deposit-link-reissue-confirm'));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
}

function renderPanel(props: { issuedLink?: IssuedDepositLink | null } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<DepositLinkListPanel issuedLink={props.issuedLink ?? null} />, { wrapper });
}

describe('DepositLinkListPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListLinks.mockResolvedValue({ links: [row()], total: 1 });
  });

  describe('the list itself', () => {
    it('opens on the unpaid links only, newest first, and asks the backend for exactly that', async () => {
      renderPanel();

      await waitFor(() => expect(mockListLinks).toHaveBeenCalled());
      expect(mockListLinks).toHaveBeenCalledWith({ status: 'open', page: 1, limit: 20 });
    });

    it('drops the filter when the desk asks for every link', async () => {
      const user = userEvent.setup();
      renderPanel();

      await waitFor(() => expect(mockListLinks).toHaveBeenCalled());
      await user.click(screen.getByRole('tab', { name: /ทั้งหมด/ }));

      await waitFor(() =>
        expect(mockListLinks).toHaveBeenLastCalledWith({ page: 1, limit: 20 }),
      );
    });

    it('renders the guest, property, amount, issuer and every one of the five states in Thai', async () => {
      mockListLinks.mockResolvedValue({
        links: EVERY_STATE.map((state, index) =>
          row({ linkId: `link-${index}`, state, guestName: `Guest ${index}` }),
        ),
        total: EVERY_STATE.length,
      });

      renderPanel();

      await waitFor(() => expect(screen.getAllByText('Guest 0').length).toBeGreaterThan(0));

      // The five Thai state labels, reused from the guest page's vocabulary
      // rather than a second one invented for the desk.
      for (const [state, label] of [
        ['awaiting_payment', 'รอชำระเงิน'],
        ['checking', 'กำลังตรวจสอบ'],
        ['confirmed', 'ยืนยันแล้ว'],
        ['expired', 'หมดอายุ'],
        ['revoked', 'ยกเลิกแล้ว'],
      ] as const) {
        const badge = action(`deposit-link-state-${state}`);
        expect(badge).toHaveTextContent(label);
      }

      expect(screen.getAllByText('โรงแรมเดอะฮาร์เบอร์ฟร้อนท์').length).toBeGreaterThan(0);
      expect(screen.getAllByText(/1,500/).length).toBeGreaterThan(0);
      expect(screen.getAllByText('Reception A').length).toBeGreaterThan(0);
    });

    it('shows the expiry in Asia/Bangkok, not in whatever zone the desk laptop is set to', async () => {
      renderPanel();

      // 05:00Z on 1 Oct 2026 is 12:00 in Bangkok. Thailand has no DST, so
      // this is exact rather than seasonal.
      await waitFor(() =>
        expect(screen.getAllByText(/01\/10\/2026, 12:00/).length).toBeGreaterThan(0),
      );
    });

    it('separates "never opened" from a link the guest has actually looked at', async () => {
      mockListLinks.mockResolvedValue({
        links: [
          row({ linkId: 'never', guestName: 'Never Opened', lastOpenedAt: null }),
          row({
            linkId: 'opened',
            guestName: 'Has Opened',
            lastOpenedAt: '2026-09-30T09:15:00.000Z',
          }),
        ],
        total: 2,
      });

      renderPanel();

      await waitFor(() =>
        expect(screen.getAllByText('Never Opened').length).toBeGreaterThan(0),
      );
      expect(screen.getAllByTestId('deposit-link-never-opened').length).toBeGreaterThan(0);
      // 09:15Z is 16:15 in Bangkok.
      expect(screen.getAllByText(/30\/09\/2026, 16:15/).length).toBeGreaterThan(0);
    });

    it('tells the desk when the list could not be loaded instead of showing an empty one', async () => {
      mockListLinks.mockRejectedValue(new Error('boom'));

      renderPanel();

      await waitFor(() =>
        expect(screen.getByTestId('deposit-link-list-error')).toBeInTheDocument(),
      );
    });
  });

  describe('revoke', () => {
    it('asks before killing a link, and does nothing when the desk backs out', async () => {
      const user = userEvent.setup();
      renderPanel();

      await waitFor(() =>
        expect(screen.getAllByText('Somchai Sooksan').length).toBeGreaterThan(0),
      );
      await user.click(action('deposit-link-revoke-link-1'));

      const dialog = await screen.findByRole('dialog');
      // Naming the guest is the point of the dialog: the desk is looking at
      // several links at once.
      expect(within(dialog).getByTestId('deposit-link-revoke-confirm-body')).toHaveTextContent(
        'Somchai Sooksan',
      );

      // No button in this dialog may be plain "ยกเลิก": that is Thai for
      // Cancel *and* the verb in "ยกเลิกลิงก์" (revoke link), and the desk
      // reads the shorter of two adjacent ยกเลิก buttons as "cancel the
      // link".
      expect(within(dialog).queryByRole('button', { name: 'ยกเลิก' })).not.toBeInTheDocument();

      await user.click(within(dialog).getByTestId('deposit-link-confirm-keep'));

      expect(mockRevokeLink).not.toHaveBeenCalled();
    });

    it('calls the revoke endpoint with the link id once confirmed', async () => {
      const user = userEvent.setup();
      mockRevokeLink.mockResolvedValue({ state: 'revoked' });
      renderPanel();

      await waitFor(() =>
        expect(screen.getAllByText('Somchai Sooksan').length).toBeGreaterThan(0),
      );
      await user.click(action('deposit-link-revoke-link-1'));

      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByTestId('deposit-link-revoke-confirm'));

      await waitFor(() => expect(mockRevokeLink).toHaveBeenCalledWith('link-1'));
    });

    it('does not also claim there are no links when the load failed', async () => {
      mockListLinks.mockRejectedValue(new Error('boom'));

      renderPanel();

      await waitFor(() =>
        expect(screen.getByTestId('deposit-link-list-error')).toBeInTheDocument(),
      );
      // "Could not load" and "there are no deposit links yet" are two
      // different statements about the same data, and the second one is the
      // dangerous one when the desk is checking whether a link is live.
      expect(screen.queryByText('ยังไม่มีลิงก์มัดจำ')).not.toBeInTheDocument();
    });

    it('hangs the count on the filter that is actually showing', async () => {
      const user = userEvent.setup();
      mockListLinks.mockResolvedValue({ links: [row()], total: 3 });

      renderPanel();

      // `total` counts through the active status filter, so on the open tab
      // it is the number of OPEN links — never the total of everything.
      const openTab = await screen.findByRole('tab', { name: /ที่ยังใช้งานอยู่/ });
      await waitFor(() => expect(openTab).toHaveTextContent('3'));
      expect(screen.getByRole('tab', { name: /ทั้งหมด/ })).not.toHaveTextContent('3');

      mockListLinks.mockResolvedValue({ links: [row()], total: 50 });
      await user.click(screen.getByRole('tab', { name: /ทั้งหมด/ }));

      await waitFor(() =>
        expect(screen.getByRole('tab', { name: /ทั้งหมด/ })).toHaveTextContent('50'),
      );
    });

    it('follows the list back to a page that exists when it shrinks under a poll', async () => {
      const user = userEvent.setup();
      mockListLinks.mockResolvedValue({ links: [row()], total: 60 });

      renderPanel();

      await waitFor(() => expect(screen.getByText(/หน้า 1 จาก 3/)).toBeInTheDocument());
      await user.click(screen.getByRole('button', { name: 'ถัดไป' }));
      await waitFor(() => expect(screen.getByText(/หน้า 2 จาก 3/)).toBeInTheDocument());

      // A batch of links gets confirmed; the open list is now one page long
      // while the desk is standing on page 2.
      mockListLinks.mockResolvedValue({ links: [row()], total: 12 });
      await user.click(screen.getByTestId('deposit-link-refresh'));

      await waitFor(() =>
        expect(mockListLinks).toHaveBeenLastCalledWith({
          status: 'open',
          page: 1,
          limit: 20,
        }),
      );
      expect(screen.queryByTestId('deposit-link-list-error')).not.toBeInTheDocument();
    });

    it('renders a row whose guest name and property came back null without leaking the key', async () => {
      mockListLinks.mockResolvedValue({
        links: [row({ guestName: null, property: null })],
        total: 1,
      });

      renderPanel();

      await waitFor(() =>
        expect(screen.getAllByText('(ไม่ระบุชื่อ)').length).toBeGreaterThan(0),
      );
      expect(screen.queryByText('property.null')).not.toBeInTheDocument();
    });

    it('offers no revoke on a link that is already dead or already paid', async () => {
      mockListLinks.mockResolvedValue({
        links: [
          row({ linkId: 'paid', state: 'confirmed' }),
          row({ linkId: 'gone', state: 'revoked' }),
        ],
        total: 2,
      });

      renderPanel();

      await waitFor(() =>
        expect(action('deposit-link-revoke-paid')).toBeDisabled(),
      );
      expect(action('deposit-link-revoke-gone')).toBeDisabled();
      // Reissue is still the way back for a dead link, but a paid booking
      // has nothing left to collect.
      expect(action('deposit-link-reissue-paid')).toBeDisabled();
      expect(action('deposit-link-reissue-gone')).toBeEnabled();
    });
  });

  describe('reissue', () => {
    const REISSUED = {
      linkId: 'link-2',
      bookingId: 'booking-1',
      token: NEW_TOKEN,
      url: `https://loyalty.saichon.com/d#${NEW_TOKEN}`,
      lineShareUrl: `https://line.me/R/share?text=${encodeURIComponent(
        `https://loyalty.saichon.com/d#${NEW_TOKEN}`,
      )}`,
      totalAmount: 3000,
      amountDueNow: 1500,
      expiresAt: '2026-10-02T05:00:00.000Z',
    };

    it('asks before minting, because reissue kills the guest link the same way revoke does', async () => {
      const user = userEvent.setup();
      renderPanel();

      await waitFor(() =>
        expect(screen.getAllByText('Somchai Sooksan').length).toBeGreaterThan(0),
      );
      await user.click(action('deposit-link-reissue-link-1'));

      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByTestId('deposit-link-reissue-confirm-body')).toHaveTextContent(
        'Somchai Sooksan',
      );

      await user.click(within(dialog).getByTestId('deposit-link-confirm-keep'));

      expect(mockReissueLink).not.toHaveBeenCalled();
    });

    it('warns when the guest it would cut off has already uploaded a slip', async () => {
      const user = userEvent.setup();
      mockListLinks.mockResolvedValue({
        links: [row({ state: 'checking' })],
        total: 1,
      });
      renderPanel();

      await waitFor(() =>
        expect(screen.getAllByText('Somchai Sooksan').length).toBeGreaterThan(0),
      );
      await user.click(action('deposit-link-reissue-link-1'));

      const dialog = await screen.findByRole('dialog');
      expect(
        within(dialog).getByTestId('deposit-link-reissue-checking-warning'),
      ).toBeInTheDocument();
    });

    it('swaps the link on screen for the one the reissue minted', async () => {
      const user = userEvent.setup();
      mockReissueLink
        .mockResolvedValueOnce({
          ...REISSUED,
          linkId: 'link-1b',
          token: OLD_TOKEN,
          url: `https://loyalty.saichon.com/d#${OLD_TOKEN}`,
        })
        .mockResolvedValueOnce(REISSUED);

      renderPanel();
      await waitFor(() =>
        expect(screen.getAllByText('Somchai Sooksan').length).toBeGreaterThan(0),
      );

      await reissueThroughDialog(user, 'deposit-link-reissue-link-1');

      const shown = await screen.findByTestId('issued-deposit-link-url');
      expect(shown).toHaveTextContent(`/d#${OLD_TOKEN}`);

      // A second reissue replaces it rather than stacking a second panel:
      // the first token is dead, and two live-looking links on one screen
      // is how the wrong one gets sent.
      await reissueThroughDialog(user, 'deposit-link-reissue-link-1');

      await waitFor(() =>
        expect(screen.getByTestId('issued-deposit-link-url')).toHaveTextContent(
          `/d#${NEW_TOKEN}`,
        ),
      );
      expect(screen.getAllByTestId('issued-deposit-link-url')).toHaveLength(1);
      expect(mockReissueLink).toHaveBeenCalledWith('link-1');

      // Reception's screen is shared. Once the link is sent, it comes off
      // the glass without a page reload.
      await user.click(action('deposit-link-dismiss-revealed'));
      await waitFor(() =>
        expect(screen.queryByTestId('issued-deposit-link-url')).not.toBeInTheDocument(),
      );
    });

    it('cannot copy or share a link whose token nobody holds, and can once it is reissued', async () => {
      const user = userEvent.setup();
      const writeText = installClipboardSpy();
      mockReissueLink.mockResolvedValue(REISSUED);
      mockListLinks.mockResolvedValue({
        links: [row(), row({ linkId: 'link-2', guestName: 'Malee' })],
        total: 2,
      });

      renderPanel();
      await waitFor(() =>
        expect(screen.getAllByText('Somchai Sooksan').length).toBeGreaterThan(0),
      );

      // The backend stores only the SHA-256 of a token, so a row read back
      // from the list can never carry a URL to copy.
      expect(action('deposit-link-copy-link-1')).toBeDisabled();
      expect(screen.queryByTestId('deposit-link-share-link-1')).not.toBeInTheDocument();

      await reissueThroughDialog(user, 'deposit-link-reissue-link-1');

      // The reissue minted link-2's token in this session.
      await waitFor(() =>
        expect(action('deposit-link-copy-link-2')).toBeEnabled(),
      );
      await user.click(action('deposit-link-copy-link-2'));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(REISSUED.url));

      const share = action('deposit-link-share-link-2');
      expect(share).toHaveAttribute('href', REISSUED.lineShareUrl);
    });

    it('never puts the token anywhere but the copy field and the LINE share intent', async () => {
      const user = userEvent.setup();
      mockReissueLink.mockResolvedValue(REISSUED);
      renderPanel();
      await waitFor(() =>
        expect(screen.getAllByText('Somchai Sooksan').length).toBeGreaterThan(0),
      );

      await reissueThroughDialog(user, 'deposit-link-reissue-link-1');
      await screen.findByTestId('issued-deposit-link-url');

      // The reissue is addressed by link id, never by token: a token in a
      // path is a token in the nginx and Cloudflare access logs.
      expect(mockReissueLink).toHaveBeenCalledWith('link-1');
      expect(JSON.stringify(mockReissueLink.mock.calls)).not.toContain(NEW_TOKEN);

      // Every element carrying the token in the DOM, enumerated: the copy
      // field the desk reads, and the share intent it hands to LINE.
      const carriers = Array.from(document.querySelectorAll('*')).filter((element) => {
        const href = element.getAttribute('href') ?? '';
        // Own text only — an ancestor "contains" the token merely by
        // wrapping the field that renders it.
        const ownText = Array.from(element.childNodes)
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent ?? '')
          .join('');
        return ownText.includes(NEW_TOKEN) || href.includes(NEW_TOKEN);
      });

      for (const element of carriers) {
        const isCopyField = element.getAttribute('data-testid') === 'issued-deposit-link-url';
        const isShareIntent = (element.getAttribute('href') ?? '').startsWith(
          'https://line.me/R/share?',
        );
        expect(isCopyField || isShareIntent).toBe(true);
      }
      expect(carriers.length).toBeGreaterThan(0);
    });
  });

  /**
   * The B2 follow-up. Before `issuedLink`, a link issued from the modal
   * arrived here as a row with no token: Copy disabled, no share intent,
   * and the only apparent cure a reload — which is the one action that
   * destroys the token for good.
   */
  describe('a link just issued from the modal', () => {
    const ISSUED: IssuedDepositLink = {
      linkId: 'link-1',
      bookingId: 'booking-1',
      token: OLD_TOKEN,
      url: `https://loyalty.saichon.com/d#${OLD_TOKEN}`,
      lineShareUrl: `https://line.me/R/share?text=${encodeURIComponent(
        `https://loyalty.saichon.com/d#${OLD_TOKEN}`,
      )}`,
      totalAmount: 3000,
      amountDueNow: 1500,
      expiresAt: '2026-10-01T05:00:00.000Z',
    };

    it('can be copied and shared straight away, with no reload', async () => {
      const user = userEvent.setup();
      const writeText = installClipboardSpy();

      renderPanel({ issuedLink: ISSUED });
      await waitFor(() => expect(action('deposit-link-copy-link-1')).toBeEnabled());

      await user.click(action('deposit-link-copy-link-1'));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(ISSUED.url));

      expect(action('deposit-link-share-link-1')).toHaveAttribute('href', ISSUED.lineShareUrl);
    });

    it('leaves every other row exactly as it was', async () => {
      mockListLinks.mockResolvedValue({
        links: [row(), row({ linkId: 'link-9', guestName: 'Malee' })],
        total: 2,
      });

      renderPanel({ issuedLink: ISSUED });
      await waitFor(() => expect(action('deposit-link-copy-link-1')).toBeEnabled());

      expect(action('deposit-link-copy-link-9')).toBeDisabled();
      expect(screen.queryByTestId('deposit-link-share-link-9')).not.toBeInTheDocument();
    });

    it('holds the token without printing it under the table', async () => {
      renderPanel({ issuedLink: ISSUED });
      await waitFor(() => expect(action('deposit-link-copy-link-1')).toBeEnabled());

      // The modal has already shown this URL once. Re-printing it here
      // would leave a live payment credential on a shared desk screen
      // after reception closed the dialog on it.
      expect(screen.queryByTestId('issued-deposit-link-url')).not.toBeInTheDocument();
    });

    it('does not resurrect a link the desk has since revoked', async () => {
      const user = userEvent.setup();
      mockRevokeLink.mockResolvedValue({ state: 'revoked' });

      renderPanel({ issuedLink: ISSUED });
      await waitFor(() => expect(action('deposit-link-copy-link-1')).toBeEnabled());

      await user.click(action('deposit-link-revoke-link-1'));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByTestId('deposit-link-revoke-confirm'));

      await waitFor(() => expect(action('deposit-link-copy-link-1')).toBeDisabled());
    });
  });

  /**
   * Guest search. Client-side over the loaded page: the list endpoint takes
   * `status`, `page` and `limit` and nothing else.
   */
  describe('guest search', () => {
    it('narrows the table to the matching guest without asking the backend again', async () => {
      const user = userEvent.setup();
      mockListLinks.mockResolvedValue({
        links: [row(), row({ linkId: 'link-2', guestName: 'Malee Chaiyo' })],
        total: 2,
      });

      renderPanel();
      await waitFor(() => expect(screen.getAllByText('Malee Chaiyo').length).toBeGreaterThan(0));
      const callsBefore = mockListLinks.mock.calls.length;

      await user.type(screen.getByTestId('deposit-link-search'), 'malee');

      await waitFor(() =>
        expect(screen.queryByText('Somchai Sooksan')).not.toBeInTheDocument(),
      );
      expect(screen.getAllByText('Malee Chaiyo').length).toBeGreaterThan(0);
      expect(mockListLinks.mock.calls.length).toBe(callsBefore);
    });

    it('matches a Thai name typed in Thai, and part of one', async () => {
      const user = userEvent.setup();
      mockListLinks.mockResolvedValue({
        links: [
          row({ linkId: 'th-1', guestName: 'สมชาย สุขสันต์' }),
          row({ linkId: 'th-2', guestName: 'มาลี ใจดี' }),
        ],
        total: 2,
      });

      renderPanel();
      await waitFor(() => expect(screen.getAllByText('มาลี ใจดี').length).toBeGreaterThan(0));

      await user.type(screen.getByTestId('deposit-link-search'), 'สมชาย');

      await waitFor(() => expect(screen.queryByText('มาลี ใจดี')).not.toBeInTheDocument());
      expect(screen.getAllByText('สมชาย สุขสันต์').length).toBeGreaterThan(0);
    });

    it('says nothing matched rather than "no deposit links yet"', async () => {
      const user = userEvent.setup();
      renderPanel();
      await waitFor(() =>
        expect(screen.getAllByText('Somchai Sooksan').length).toBeGreaterThan(0),
      );

      await user.type(screen.getByTestId('deposit-link-search'), 'zzzz');

      // Desktop table and mobile card both render the empty state.
      await waitFor(() =>
        expect(screen.getAllByText('ไม่พบลิงก์ที่ตรงกับคำค้นหา').length).toBeGreaterThan(0),
      );
      expect(screen.queryByText('ยังไม่มีลิงก์มัดจำ')).not.toBeInTheDocument();
    });

    it('finds the guest by the phone number reception dialled', async () => {
      const user = userEvent.setup();
      mockListLinks.mockResolvedValue({
        links: [
          row(),
          row({ linkId: 'link-2', guestName: 'Malee Chaiyo', guestPhone: '089 999 0000' }),
        ],
        total: 2,
      });

      renderPanel();
      await waitFor(() => expect(screen.getAllByText('Malee Chaiyo').length).toBeGreaterThan(0));

      // Typed without separators against a row that stores them: both sides
      // are reduced to digits, so the dashes cannot hide the match.
      await user.type(screen.getByTestId('deposit-link-search'), '0812345678');

      await waitFor(() => expect(screen.queryByText('Malee Chaiyo')).not.toBeInTheDocument());
      expect(screen.getAllByText('Somchai Sooksan').length).toBeGreaterThan(0);
      // A search that works needs no apology.
      expect(screen.queryByTestId('deposit-link-search-no-phone')).not.toBeInTheDocument();
    });

    it('matches a phone number typed with the separators reception uses', async () => {
      const user = userEvent.setup();
      mockListLinks.mockResolvedValue({
        links: [
          row({ guestPhone: '0812345678' }),
          row({ linkId: 'link-2', guestName: 'Malee Chaiyo', guestPhone: '0899990000' }),
        ],
        total: 2,
      });

      renderPanel();
      await waitFor(() => expect(screen.getAllByText('Malee Chaiyo').length).toBeGreaterThan(0));

      await user.type(screen.getByTestId('deposit-link-search'), '081-234-5678');

      await waitFor(() => expect(screen.queryByText('Malee Chaiyo')).not.toBeInTheDocument());
      expect(screen.getAllByText('Somchai Sooksan').length).toBeGreaterThan(0);
    });

    it('tells the desk when not one loaded row carries a phone number', async () => {
      const user = userEvent.setup();
      mockListLinks.mockResolvedValue({
        links: [row({ guestPhone: null })],
        total: 1,
      });

      renderPanel();
      await waitFor(() =>
        expect(screen.getAllByText('Somchai Sooksan').length).toBeGreaterThan(0),
      );

      await user.type(screen.getByTestId('deposit-link-search'), '0812345678');

      // Nothing on this page could ever match, and an empty table would read
      // as "this guest has no link" — a different, wrong answer.
      await waitFor(() =>
        expect(screen.getByTestId('deposit-link-search-no-phone')).toBeInTheDocument(),
      );

      await user.clear(screen.getByTestId('deposit-link-search'));
      await user.type(screen.getByTestId('deposit-link-search'), 'Somchai');
      await waitFor(() =>
        expect(screen.queryByTestId('deposit-link-search-no-phone')).not.toBeInTheDocument(),
      );
    });

    it('does not let a digit in a name search drag in every phone number', async () => {
      const user = userEvent.setup();
      mockListLinks.mockResolvedValue({
        links: [
          row({ guestName: 'Somchai 8' }),
          row({ linkId: 'link-2', guestName: 'Malee Chaiyo', guestPhone: '0899998888' }),
        ],
        total: 2,
      });

      renderPanel();
      await waitFor(() => expect(screen.getAllByText('Malee Chaiyo').length).toBeGreaterThan(0));

      // "8" is not phone-shaped, so it stays a name search — otherwise every
      // guest whose number contains an 8 would answer it.
      await user.type(screen.getByTestId('deposit-link-search'), '8');

      await waitFor(() => expect(screen.queryByText('Malee Chaiyo')).not.toBeInTheDocument());
      expect(screen.getAllByText('Somchai 8').length).toBeGreaterThan(0);
    });

    it('admits it is only searching this page once there is more than one', async () => {
      const user = userEvent.setup();
      mockListLinks.mockResolvedValue({ links: [row()], total: 60 });

      renderPanel();
      await waitFor(() => expect(screen.getByText(/หน้า 1 จาก 3/)).toBeInTheDocument());
      expect(screen.queryByTestId('deposit-link-search-scope')).not.toBeInTheDocument();

      await user.type(screen.getByTestId('deposit-link-search'), 'Somchai');

      await waitFor(() =>
        expect(screen.getByTestId('deposit-link-search-scope')).toBeInTheDocument(),
      );
    });

    it('clears back to the whole page', async () => {
      const user = userEvent.setup();
      mockListLinks.mockResolvedValue({
        links: [row(), row({ linkId: 'link-2', guestName: 'Malee Chaiyo' })],
        total: 2,
      });

      renderPanel();
      await waitFor(() => expect(screen.getAllByText('Malee Chaiyo').length).toBeGreaterThan(0));

      await user.type(screen.getByTestId('deposit-link-search'), 'malee');
      await waitFor(() =>
        expect(screen.queryByText('Somchai Sooksan')).not.toBeInTheDocument(),
      );

      await user.click(screen.getByTestId('deposit-link-search-clear'));

      await waitFor(() =>
        expect(screen.getAllByText('Somchai Sooksan').length).toBeGreaterThan(0),
      );
    });

    it('does not match a row whose guest name came back null', async () => {
      const user = userEvent.setup();
      mockListLinks.mockResolvedValue({
        links: [row({ linkId: 'anon', guestName: null, guestPhone: null })],
        total: 1,
      });

      renderPanel();
      await waitFor(() =>
        expect(screen.getAllByText('(ไม่ระบุชื่อ)').length).toBeGreaterThan(0),
      );

      await user.type(screen.getByTestId('deposit-link-search'), 'somchai');

      await waitFor(() =>
        expect(screen.getAllByText('ไม่พบลิงก์ที่ตรงกับคำค้นหา').length).toBeGreaterThan(0),
      );
    });
  });
});
