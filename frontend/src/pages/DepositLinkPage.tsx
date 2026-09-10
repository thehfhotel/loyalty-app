import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { FiCheckCircle, FiClock, FiDownload, FiPhone, FiUpload } from 'react-icons/fi';
import axios from 'axios';
import { Badge, Button, Card } from '../components/ui';
import {
  depositLinkService,
  isDepositLinkState,
  type DepositLinkState,
  type DepositPage,
  type Property,
} from '../services/depositLinkService';
import { depositPollIntervalMs } from '../utils/depositPolling';
import { depositFragmentUrl, readDepositToken } from '../utils/depositToken';
import { deskPhone, deskPhoneHref } from '../utils/deskContact';
import { guestSlipOkStatusKey } from '../types/slipok';
import { formatDateToDDMMYYYY, formatDateTimeToEuropean } from '../utils/dateFormatter';
import { logger } from '../utils/logger';

/**
 * The public deposit page (B1 §3 and §4).
 *
 * `https://loyalty.saichon.com/d#<token>` — no login, no app shell, no tab
 * bar. Tapped in a LINE chat it opens in LINE's in-app browser and renders
 * this SPA route; nothing here needs the LIFF SDK, because nothing here
 * needs an identity. The token in the **fragment** is the whole capability.
 *
 * The fragment is load-bearing, not cosmetic: it is the one part of a URL
 * a browser never sends, so the token cannot reach the frontend
 * container's access log, Cloudflare's HTTP logs, or a `Referer` header.
 * `utils/depositToken` holds the rule and the `/d/<token>` grace-period
 * rewrite; the page below only asks it for a token.
 *
 * Thai first with one English line under each heading: most of these guests
 * booked by phone in Thai, and the rest must still be able to pay. The two
 * languages come from the `th` and `en` bundles via `getFixedT`, so the copy
 * still lives in the locale files rather than in JSX.
 *
 * Old-Android LINE-browser constraints (see the housekeeping photo lesson):
 * a plain `<input type="file" accept="image/*">` with NO `capture`
 * attribute, so gallery selection stays available, and an `<img>` decode
 * for the preview — `createImageBitmap` does not exist on those webviews.
 */

const MAX_SLIP_BYTES = 10 * 1024 * 1024;
const ACCEPTED_SLIP_TYPES = /^image\/(jpeg|jpg|png)$/;

function formatAmount(amount: number): string {
  return new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 }).format(amount);
}

/** Thai heading with the English line under it. */
function Bilingual({
  thai,
  english,
  as = 'h2',
  className,
}: {
  thai: string;
  english: string;
  as?: 'h1' | 'h2' | 'h3';
  className?: string;
}) {
  const Tag = as;
  return (
    <div className={className}>
      <Tag className={as === 'h1' ? 'text-display text-ink' : 'text-title text-ink'}>{thai}</Tag>
      <p className="text-caption text-ink-muted">{english}</p>
    </div>
  );
}

/** One line of the stay summary: label in both languages, value once. */
function SummaryRow({ thai, english, value }: { thai: string; english: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-caption text-ink-muted">
        {thai} <span className="text-ink-faint">/ {english}</span>
      </span>
      <span className="text-body text-ink">{value}</span>
    </div>
  );
}

/**
 * The page's own frame. Defined at module scope, not inside the component:
 * a nested component definition is a new type on every render, which would
 * remount the subtree and drop the slip the guest just picked.
 */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface-page px-4 py-8">
      <main className="mx-auto w-full max-w-md space-y-4">{children}</main>
    </div>
  );
}

export default function DepositLinkPage() {
  // The URL is read once per navigation rather than through the router:
  // the token lives in the fragment, which react-router does not route on.
  const [resolved, setResolved] = useState(() => readDepositToken(window.location));
  const token = resolved.token;
  const { i18n } = useTranslation();
  const th = useMemo(() => i18n.getFixedT('th'), [i18n]);
  const en = useMemo(() => i18n.getFixedT('en'), [i18n]);

  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [slipPreview, setSlipPreview] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [engagedAt, setEngagedAt] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // A link already sent to a guest may still carry the old `/d/<token>`
  // shape. Rewrite it to `/d#<token>` in place: `replaceState` changes the
  // address bar and the history entry without making a request, so the
  // token stops being in the URL and never reaches a log on the way out.
  // Only the page load that started this session ever carried it.
  useEffect(() => {
    if (resolved.fromLegacyPath && resolved.token) {
      window.history.replaceState(null, '', depositFragmentUrl(resolved.token));
      setResolved({ token: resolved.token, fromLegacyPath: false });
    }
  }, [resolved]);

  // A reissued link pasted into the same tab changes only the fragment, so
  // the browser fires `hashchange` and never reloads. Without this the
  // guest would sit on the dead link's page.
  useEffect(() => {
    const onHashChange = () => setResolved(readDepositToken(window.location));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const depositQuery = useQuery<DepositPage>({
    queryKey: ['deposit-link', token],
    queryFn: () => depositLinkService.getDepositPage(token ?? ''),
    enabled: Boolean(token),
    retry: false,
    // Cadence is B1 §3's, expressed once in `depositPollIntervalMs` so the
    // rule is unit-testable without a rendered page and a fake clock.
    refetchInterval: (query) =>
      depositPollIntervalMs({
        state: query.state.data?.state,
        engagedAt,
        now: Date.now(),
      }),
  });

  const deposit = depositQuery.data;
  // Vocabulary guard, the same defensive choice `guestSlipOkStatusKey` makes
  // for slip statuses. A `state` this bundle predates must never reach a
  // guest as a raw i18n key or as a page with no card on it, so it reads as
  // "being checked" and the page keeps polling until it resolves.
  const state: DepositLinkState | undefined = deposit
    ? isDepositLinkState(deposit.state)
      ? deposit.state
      : 'checking'
    : undefined;

  // A link reopened after an upload (another phone, another session) arrives
  // already `checking`; start the fast window from that first sighting so the
  // guest still sees the flip without a manual reload.
  useEffect(() => {
    if (state === 'checking') {
      setEngagedAt((current) => current ?? Date.now());
    }
  }, [state]);

  // Render the per-property PromptPay QR from the payload the API returned.
  // Never from `/api/payments/promptpay-qr`: that one builds the group-wide
  // tax id, while the slip matcher compares the payee against the property's
  // own account, so every slip would come back `receiver_mismatch`.
  useEffect(() => {
    const payload = deposit?.promptpayQrPayload;
    if (!payload) {
      setQrDataUrl('');
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(payload, { width: 320, margin: 2, errorCorrectionLevel: 'M' })
      .then((url) => {
        if (!cancelled) {
          setQrDataUrl(url);
        }
      })
      .catch((error: unknown) => {
        logger.error(
          'Failed to render the deposit PromptPay QR:',
          error instanceof Error ? error.message : String(error),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [deposit?.promptpayQrPayload]);

  const uploadMutation = useMutation({
    mutationFn: (file: File) => depositLinkService.uploadSlip(token ?? '', file),
    onSuccess: async () => {
      setSlipFile(null);
      setSlipPreview(null);
      setUploadError(null);
      setEngagedAt(Date.now());
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      await depositQuery.refetch();
    },
    onError: async (error: unknown) => {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      // "Please try again" is the wrong instruction for two of these. The
      // upload is rate limited at 5 per hour per token and 20 per hour per IP
      // (B1 §5), and a link revoked between page load and upload answers 409
      // — in both cases another tap only burns the guest's remaining budget.
      if (status === 429) {
        setUploadError(th('depositLink.upload.rateLimited'));
        return;
      }
      if (status === 409 || status === 410) {
        setUploadError(th('depositLink.upload.linkClosed'));
        // Refetch so the page flips to the expired/revoked card, which is
        // the one that carries the call-the-desk line.
        await depositQuery.refetch();
        return;
      }
      if (status === 413) {
        setUploadError(th('depositLink.upload.tooLarge'));
        return;
      }
      setUploadError(th('depositLink.upload.failed'));
    },
  });

  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }
      // Rejected here, before any request: the backend runs the same
      // magic-byte check, but a guest on a phone should not spend an upload
      // to learn they picked a PDF.
      if (!ACCEPTED_SLIP_TYPES.test(file.type)) {
        setSlipFile(null);
        setSlipPreview(null);
        setUploadError(th('depositLink.upload.invalidType'));
        return;
      }
      if (file.size > MAX_SLIP_BYTES) {
        setSlipFile(null);
        setSlipPreview(null);
        setUploadError(th('depositLink.upload.tooLarge'));
        return;
      }
      setUploadError(null);
      setSlipFile(file);
      // FileReader + <img>, never createImageBitmap: the maid-phone lesson
      // applies to guest phones too.
      const reader = new FileReader();
      reader.onload = (loaded) => {
        const result = loaded.target?.result;
        setSlipPreview(typeof result === 'string' ? result : null);
      };
      reader.onerror = () => setSlipPreview(null);
      reader.readAsDataURL(file);
    },
    [th],
  );

  const handleSubmitSlip = useCallback(() => {
    if (slipFile) {
      uploadMutation.mutate(slipFile);
    }
  }, [slipFile, uploadMutation]);

  const notFound =
    !token ||
    (axios.isAxiosError(depositQuery.error) && depositQuery.error.response?.status === 404);

  const property: Property | null = deposit?.property ?? null;
  const phone = deskPhone(property);

  const deskLine = phone ? (
    <a
      href={deskPhoneHref(phone)}
      className="inline-flex items-center gap-2 text-body text-brand-700 hover:underline"
      data-testid="desk-phone"
    >
      <FiPhone className="h-4 w-4" aria-hidden="true" />
      {th('depositLink.desk.withPhone', { phone })}
    </a>
  ) : (
    <p className="text-body text-ink-muted" data-testid="desk-phone">
      {th('depositLink.desk.withoutPhone')}
    </p>
  );

  const deskBlock = (
    <div className="space-y-1">
      {deskLine}
      <p className="text-caption text-ink-muted">
        {phone
          ? en('depositLink.desk.withPhone', { phone })
          : en('depositLink.desk.withoutPhone')}
      </p>
    </div>
  );

  if (token && depositQuery.isPending && !depositQuery.isError) {
    return (
      <Shell>
        <Card>
          <p className="text-body text-ink-muted" role="status">
            {th('depositLink.loading')} / {en('depositLink.loading')}
          </p>
        </Card>
      </Shell>
    );
  }

  if (notFound || !deposit) {
    const key = notFound ? 'notFound' : 'loadFailed';
    return (
      <Shell>
        <Card className="space-y-4" data-testid={`deposit-${key}`}>
          <Bilingual
            as="h1"
            thai={th(`depositLink.${key}.heading`)}
            english={en(`depositLink.${key}.heading`)}
          />
          <div>
            <p className="text-body text-ink">{th(`depositLink.${key}.body`)}</p>
            <p className="text-caption text-ink-muted">{en(`depositLink.${key}.body`)}</p>
          </div>
          {!notFound && (
            <Button type="button" variant="secondary" onClick={() => depositQuery.refetch()}>
              {th('depositLink.loadFailed.retry')} / {en('depositLink.loadFailed.retry')}
            </Button>
          )}
          {deskBlock}
        </Card>
      </Shell>
    );
  }

  const balanceDue = Math.max(0, deposit.totalAmount - deposit.amountDueNow);
  const expiresAtText = formatDateTimeToEuropean(deposit.expiresAt) ?? deposit.expiresAt;
  const isAwaitingPayment = state === 'awaiting_payment';
  const isChecking = state === 'checking';
  const isConfirmed = state === 'confirmed';
  const isDead = state === 'expired' || state === 'revoked';

  return (
    <Shell>
      <header className="space-y-1" data-testid="deposit-header">
        <Bilingual as="h1" thai={th('depositLink.title')} english={en('depositLink.title')} />
        <p className="text-body text-ink-muted">{th(`property.${deposit.property}`)}</p>
        <Badge tone={isConfirmed ? 'success' : isDead ? 'neutral' : 'warning'} data-testid="deposit-state">
          {th(`depositLink.state.${state}`)}
        </Badge>
      </header>

      <Card className="space-y-1" data-testid="deposit-stay">
        <Bilingual thai={th('depositLink.stay.heading')} english={en('depositLink.stay.heading')} />
        <SummaryRow
          thai={th('depositLink.stay.guest')}
          english={en('depositLink.stay.guest')}
          value={deposit.guestGivenName}
        />
        <SummaryRow
          thai={th('depositLink.stay.checkIn')}
          english={en('depositLink.stay.checkIn')}
          value={formatDateToDDMMYYYY(deposit.checkIn) ?? deposit.checkIn}
        />
        <SummaryRow
          thai={th('depositLink.stay.checkOut')}
          english={en('depositLink.stay.checkOut')}
          value={formatDateToDDMMYYYY(deposit.checkOut) ?? deposit.checkOut}
        />
        <SummaryRow
          thai={th('depositLink.stay.nights')}
          english={en('depositLink.stay.nights')}
          value={th('depositLink.stay.nightsValue', { count: deposit.nights })}
        />
        <SummaryRow
          thai={th('depositLink.stay.roomType')}
          english={en('depositLink.stay.roomType')}
          value={deposit.roomTypeName}
        />
        <SummaryRow
          thai={th('depositLink.stay.total')}
          english={en('depositLink.stay.total')}
          value={`${formatAmount(deposit.totalAmount)} ${th('depositLink.currency')}`}
        />
      </Card>

      {(isAwaitingPayment || isChecking) && (
        <Card className="space-y-2" data-testid="deposit-amount">
          <Bilingual thai={th('depositLink.amountDueNow')} english={en('depositLink.amountDueNow')} />
          <p className="text-display-lg text-ink">
            {formatAmount(deposit.amountDueNow)}{' '}
            <span className="text-title text-ink-muted">{th('depositLink.currency')}</span>
          </p>
          <p className="text-caption text-ink-muted">
            {th('depositLink.balanceDue')}: {formatAmount(balanceDue)} {th('depositLink.currency')}
          </p>
        </Card>
      )}

      {isAwaitingPayment && (
        <Card className="space-y-4" data-testid="deposit-qr">
          <Bilingual thai={th('depositLink.qr.heading')} english={en('depositLink.qr.heading')} />
          {qrDataUrl ? (
            <div className="space-y-3 text-center">
              <img
                src={qrDataUrl}
                alt={th('depositLink.qr.alt')}
                className="mx-auto h-auto w-full max-w-[16rem] rounded-card border border-hairline bg-surface-card p-3"
              />
              <a
                href={qrDataUrl}
                download="promptpay-deposit-qr.png"
                className="inline-flex items-center gap-2 text-body text-brand-700 hover:underline"
              >
                <FiDownload className="h-4 w-4" aria-hidden="true" />
                {th('depositLink.qr.save')}
              </a>
            </div>
          ) : (
            <p className="text-body text-ink-muted">{th('depositLink.qr.unavailable')}</p>
          )}
          <div>
            <p className="text-body text-ink">{th('depositLink.qr.hint')}</p>
            <p className="text-caption text-ink-muted">{en('depositLink.qr.hint')}</p>
          </div>
        </Card>
      )}

      {isAwaitingPayment && (
        <Card className="space-y-4" data-testid="deposit-upload">
          <Bilingual thai={th('depositLink.upload.heading')} english={en('depositLink.upload.heading')} />
          <div>
            <p className="text-body text-ink">{th('depositLink.upload.hint')}</p>
            <p className="text-caption text-ink-muted">{en('depositLink.upload.hint')}</p>
          </div>

          {/* No `capture` attribute on purpose: old Android LINE webviews
              drop the file picker entirely when it is present, and the slip
              is nearly always already in the gallery. */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png"
            onChange={handleFileChange}
            data-testid="deposit-slip-input"
            className="block w-full text-body text-ink"
          />

          {slipPreview && (
            <img
              src={slipPreview}
              alt={th('depositLink.upload.previewAlt')}
              onError={() => setSlipPreview(null)}
              className="mx-auto h-auto w-full max-w-[16rem] rounded-card border border-hairline"
            />
          )}

          {uploadError && (
            <p role="alert" className="text-caption text-error-600" data-testid="deposit-upload-error">
              {uploadError}
            </p>
          )}

          <Button
            type="button"
            onClick={handleSubmitSlip}
            disabled={!slipFile || uploadMutation.isPending}
            loading={uploadMutation.isPending}
            className="w-full"
            data-testid="deposit-slip-submit"
          >
            <FiUpload className="h-4 w-4" aria-hidden="true" />
            {uploadMutation.isPending
              ? th('depositLink.upload.sending')
              : th('depositLink.upload.submit')}
          </Button>

          <p className="flex items-center gap-2 text-caption text-ink-muted">
            <FiClock className="h-4 w-4" aria-hidden="true" />
            {th('depositLink.expiresAt', { time: expiresAtText })}
          </p>
        </Card>
      )}

      {isChecking && (
        <Card className="space-y-2" data-testid="deposit-checking">
          <Bilingual
            thai={th('depositLink.checking.heading')}
            english={en('depositLink.checking.heading')}
          />
          <p className="text-body text-ink">{th('depositLink.checking.body')}</p>
          <p className="text-caption text-ink-muted">{en('depositLink.checking.body')}</p>
          {/* The guest vocabulary collapses every non-verified machine
              verdict onto "being checked" — a vendor outage never reaches a
              guest's phone as an error, and no vendor is ever named. */}
          <Badge tone="warning" data-testid="deposit-slipok-status">
            {th(guestSlipOkStatusKey(deposit.slipokStatus))}
          </Badge>
        </Card>
      )}

      {isConfirmed && (
        <Card className="space-y-3" data-testid="deposit-confirmed">
          <div className="flex items-start gap-3">
            <FiCheckCircle className="mt-1 h-6 w-6 text-success-600" aria-hidden="true" />
            <Bilingual
              thai={th('depositLink.confirmed.heading')}
              english={en('depositLink.confirmed.heading')}
            />
          </div>
          <p className="text-body text-ink">{th('depositLink.confirmed.body')}</p>
          <p className="text-caption text-ink-muted">{en('depositLink.confirmed.body')}</p>
          <div className="rounded-card bg-surface-sunken p-4">
            <p className="text-caption text-ink-muted">{th('depositLink.balanceDue')}</p>
            <p className="text-title text-ink">
              {formatAmount(balanceDue)} {th('depositLink.currency')}
            </p>
            <p className="text-fine text-ink-muted">{en('depositLink.balanceDue')}</p>
          </div>
          <p className="text-caption text-ink-muted">{th('depositLink.confirmed.notReceipt')}</p>
          <p className="text-fine text-ink-muted">{en('depositLink.confirmed.notReceipt')}</p>
        </Card>
      )}

      {isDead && (
        <Card className="space-y-3" data-testid={`deposit-${state}`}>
          <Bilingual
            thai={th(`depositLink.${state}.heading`)}
            english={en(`depositLink.${state}.heading`)}
          />
          <p className="text-body text-ink">{th(`depositLink.${state}.body`)}</p>
          <p className="text-caption text-ink-muted">{en(`depositLink.${state}.body`)}</p>
          {deskBlock}
        </Card>
      )}

      <Card className="space-y-2" data-testid="deposit-footer">
        {/* PDPA (B1 §5): the payer is frequently not the guest, so a slip
            routinely carries a third party's bank details, and this line
            ships with the page rather than after it. It deliberately claims
            only what is true today — purpose limitation and the third-party
            payer warning. The retention period, the access-logging promise
            and the slip card on /privacy are F1/F2's, and the F drafts say
            not to publish a notice describing controls that do not exist
            yet (`f-policy-copy-drafts.md` §3, still carrying [CONFIRM] on
            the retention period and the named contact). */}
        <p className="text-caption text-ink-muted">{th('depositLink.privacyNote')}</p>
        <p className="text-fine text-ink-muted">{en('depositLink.privacyNote')}</p>
        <Link to="/privacy" className="text-caption text-brand-700 hover:underline">
          {th('depositLink.privacyLink')}
        </Link>
        {!isDead && deskBlock}
      </Card>
    </Shell>
  );
}
