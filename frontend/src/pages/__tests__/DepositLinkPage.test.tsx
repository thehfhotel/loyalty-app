import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { AxiosError, AxiosHeaders } from 'axios';

// The real i18n bundles, not a stub: the whole point of these assertions is
// that the shipped Thai copy reaches the guest's phone. A mocked `t` that
// echoes keys would pass while the page rendered `depositLink.confirmed.heading`.
import '../../i18n/config';

const mockGetDepositPage = vi.fn();
const mockUploadSlip = vi.fn();

// Keep the module's real vocabulary helpers (`isTerminalDepositLinkState`
// backs the polling policy) and replace only the network surface.
vi.mock('../../services/depositLinkService', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../services/depositLinkService')>();
  return {
    ...actual,
    depositLinkService: {
      getDepositPage: (...args: unknown[]) => mockGetDepositPage(...args),
      uploadSlip: (...args: unknown[]) => mockUploadSlip(...args),
    },
  };
});

vi.mock('qrcode', () => ({
  default: {
    toDataURL: () => Promise.resolve('data:image/png;base64,fake-qr'),
  },
}));

vi.mock('react-router', () => ({
  useParams: () => ({ token: 'test-token' }),
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

import DepositLinkPage from '../DepositLinkPage';

const BASE_PAGE = {
  property: 'hfville' as const,
  guestGivenName: 'สมชาย',
  checkIn: '2026-10-01',
  checkOut: '2026-10-03',
  nights: 2,
  roomTypeName: 'Deluxe',
  totalAmount: 4000,
  amountDueNow: 2000,
  currency: 'THB',
  promptpayQrPayload: '00020101021229370016A000000677010111',
  expiresAt: '2026-10-01T05:00:00.000Z',
  state: 'awaiting_payment' as const,
  slipokStatus: null,
  slipokReason: null,
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <DepositLinkPage />
    </QueryClientProvider>,
  );
}

/** Mount and let the initial query settle (the loading card disappears). */
async function renderSettled() {
  const result = renderPage();
  await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  return result;
}

function notFoundError() {
  return new AxiosError(
    'Not Found',
    'ERR_BAD_REQUEST',
    undefined,
    undefined,
    {
      status: 404,
      statusText: 'Not Found',
      data: {},
      headers: new AxiosHeaders(),
      config: { headers: new AxiosHeaders() },
    },
  );
}

describe('DepositLinkPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDepositPage.mockResolvedValue(BASE_PAGE);
  });

  describe('the five states', () => {
    it('awaiting_payment shows the amount, the QR and the upload control', async () => {
      await renderSettled();

      expect(screen.getByText('ยอดที่ต้องชำระตอนนี้')).toBeInTheDocument();
      expect(screen.getByTestId('deposit-amount').textContent).toContain('2,000');
      expect(screen.getByAltText('QR พร้อมเพย์สำหรับชำระเงินมัดจำ')).toBeInTheDocument();
      expect(screen.getByText('สแกน QR นี้ด้วยแอปธนาคารของท่าน ยอดเงินถูกกรอกไว้ให้แล้ว')).toBeInTheDocument();
      expect(screen.getByTestId('deposit-slip-input')).toBeInTheDocument();
      // The PDPA line ships with the page, not after it (spec §5).
      expect(
        screen.getByText(
          'เราใช้ภาพสลิปเพื่อตรวจสอบการชำระเงินครั้งนี้เท่านั้น และเก็บไว้ตามระยะเวลาที่ระบุในประกาศความเป็นส่วนตัว',
        ),
      ).toBeInTheDocument();
    });

    it('checking shows the Thai "being checked" copy and never a vendor verdict', async () => {
      mockGetDepositPage.mockResolvedValue({
        ...BASE_PAGE,
        state: 'checking',
        // A machine verdict the desk would read as "manual check needed";
        // the guest must still only see "being checked".
        slipokStatus: 'manual',
        slipokReason: 'amount_mismatch',
      });
      await renderSettled();

      expect(screen.getByTestId('deposit-checking')).toBeInTheDocument();
      expect(screen.getByText('กำลังตรวจสอบสลิป')).toBeInTheDocument();
      expect(
        screen.getByText('กำลังตรวจสอบสลิปการโอนเงินของท่าน เราจะแจ้งผลทันทีที่ตรวจสอบเสร็จ'),
      ).toBeInTheDocument();
      // `manual` collapses onto the same reassuring word as `pending`.
      expect(screen.getByTestId('deposit-slipok-status')).toHaveTextContent('กำลังตรวจสอบ');
      expect(screen.queryByText('ยอดโอนไม่ตรงกับยอดที่ต้องชำระ')).not.toBeInTheDocument();
    });

    it('confirmed shows the confirmation, the balance due at check-in and the not-a-receipt line', async () => {
      mockGetDepositPage.mockResolvedValue({ ...BASE_PAGE, state: 'confirmed' });
      await renderSettled();

      const panel = screen.getByTestId('deposit-confirmed');
      expect(screen.getByText('ยืนยันการจองแล้ว')).toBeInTheDocument();
      expect(screen.getByText('ตรวจสอบสลิปเรียบร้อย การจองของท่านได้รับการยืนยันแล้ว')).toBeInTheDocument();
      expect(panel.textContent).toContain('2,000');
      expect(
        screen.getByText(
          'ข้อความนี้เป็นการยืนยันการจอง ไม่ใช่ใบเสร็จรับเงิน หากต้องการใบเสร็จ กรุณาแจ้งพนักงานที่แผนกต้อนรับตอนเช็คอิน',
        ),
      ).toBeInTheDocument();
      // Nothing left to pay through the page.
      expect(screen.queryByTestId('deposit-slip-input')).not.toBeInTheDocument();
    });

    it('expired sends the guest to the desk instead of the QR', async () => {
      mockGetDepositPage.mockResolvedValue({ ...BASE_PAGE, state: 'expired' });
      await renderSettled();

      expect(screen.getByTestId('deposit-expired')).toBeInTheDocument();
      expect(screen.getByText('ลิงก์นี้หมดอายุแล้ว')).toBeInTheDocument();
      // No desk number is configured yet (B16), so the fallback must still
      // be a way out rather than nothing at all.
      const deskLines = screen
        .getAllByTestId('desk-phone')
        .map((element) => element.textContent ?? '');
      expect(deskLines.join(' ')).toContain('กรุณาติดต่อแผนกต้อนรับของโรงแรมที่ท่านจอง');
      expect(screen.queryByTestId('deposit-qr')).not.toBeInTheDocument();
    });

    it('revoked says the link no longer works and points at the desk', async () => {
      mockGetDepositPage.mockResolvedValue({ ...BASE_PAGE, state: 'revoked' });
      await renderSettled();

      expect(screen.getByTestId('deposit-revoked')).toBeInTheDocument();
      expect(screen.getByText('ลิงก์นี้ถูกยกเลิกแล้ว')).toBeInTheDocument();
      expect(screen.queryByTestId('deposit-slip-input')).not.toBeInTheDocument();
    });
  });

  it('renders the not-found page for an unknown token, with no booking detail', async () => {
    mockGetDepositPage.mockRejectedValue(notFoundError());
    await renderSettled();

    expect(screen.getByTestId('deposit-notFound')).toBeInTheDocument();
    expect(screen.getByText('ไม่พบลิงก์นี้')).toBeInTheDocument();
    expect(screen.queryByText('สมชาย')).not.toBeInTheDocument();
  });

  describe('the slip upload', () => {
    it('offers a plain gallery picker with no capture attribute', async () => {
      await renderSettled();

      const input = screen.getByTestId('deposit-slip-input');
      // `capture` makes old Android LINE webviews drop the picker entirely,
      // and the slip is nearly always already in the gallery.
      expect(input).not.toHaveAttribute('capture');
      expect(input).toHaveAttribute('accept', 'image/jpeg,image/png');
      expect(input).not.toHaveAttribute('multiple');
    });

    it('rejects a non-image before spending an upload on it', async () => {
      await renderSettled();

      const input = screen.getByTestId('deposit-slip-input') as HTMLInputElement;
      const notAnImage = new File(['%PDF-1.4'], 'receipt.pdf', { type: 'application/pdf' });
      await act(async () => {
        fireEvent.change(input, { target: { files: [notAnImage] } });
      });

      expect(screen.getByTestId('deposit-upload-error')).toHaveTextContent(
        'กรุณาเลือกไฟล์รูปภาพ JPG หรือ PNG',
      );
      expect(mockUploadSlip).not.toHaveBeenCalled();
      expect(screen.getByTestId('deposit-slip-submit')).toBeDisabled();
    });

    it('sends an accepted image to the locked upload endpoint', async () => {
      mockUploadSlip.mockResolvedValue({
        slipId: 'slip-1',
        state: 'checking',
        slipokStatus: 'pending',
      });
      await renderSettled();

      const input = screen.getByTestId('deposit-slip-input') as HTMLInputElement;
      const slip = new File(['jpeg-bytes'], 'slip.jpg', { type: 'image/jpeg' });
      await act(async () => {
        fireEvent.change(input, { target: { files: [slip] } });
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId('deposit-slip-submit'));
        await Promise.resolve();
      });

      expect(mockUploadSlip).toHaveBeenCalledWith('test-token', slip);
    });
  });

  describe('polling', () => {
    it('stops polling once the booking is confirmed', async () => {
      vi.useFakeTimers();
      mockGetDepositPage.mockResolvedValue({ ...BASE_PAGE, state: 'confirmed' });

      renderPage();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(screen.getByTestId('deposit-confirmed')).toBeInTheDocument();
      expect(mockGetDepositPage).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(180_000);
      });

      expect(mockGetDepositPage).toHaveBeenCalledTimes(1);
    });

    it('keeps polling while a slip is being checked', async () => {
      vi.useFakeTimers();
      mockGetDepositPage.mockResolvedValue({ ...BASE_PAGE, state: 'checking' });

      renderPage();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(screen.getByTestId('deposit-checking')).toBeInTheDocument();
      expect(mockGetDepositPage).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_100);
      });

      expect(mockGetDepositPage.mock.calls.length).toBeGreaterThan(1);
    });
  });
});
