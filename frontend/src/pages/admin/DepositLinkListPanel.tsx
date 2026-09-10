import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FiCopy, FiExternalLink, FiRefreshCw, FiRotateCcw, FiSlash } from 'react-icons/fi';
import { Badge, Button, Card, EmptyState, Modal, TabNav, Table } from '../../components/ui';
import type { BadgeTone, TabItem, TableColumn } from '../../components/ui';
import IssuedDepositLinkPanel from './IssuedDepositLinkPanel';
import {
  depositLinkService,
  type DepositLinkListItem,
  type DepositLinkState,
  type IssuedDepositLink,
} from '../../services/depositLinkService';
import { logger } from '../../utils/logger';
import { formatBangkokDateTime, formatRelativeTime } from '../../utils/bangkokTime';

/**
 * "ลิงก์มัดจำ" — the desk's view of every deposit request link (B2).
 *
 * B1 gave reception a way to *issue* a link and a booking row to verify the
 * slip on. What it could not give them is the question they actually ask an
 * hour later: which links are still unpaid, which guest never even opened
 * theirs, and which one needs killing because the booking moved. That is
 * this panel.
 *
 * ## Copy and share are not row actions in the usual sense
 *
 * The backend stores the SHA-256 of a token and nothing else, so a list row
 * cannot carry a `url` — there is no `url` on the wire and there never will
 * be. The plain link exists exactly once, in the create/reissue response.
 * So Copy and Share light up only for a link this browser session minted
 * (`sessionLinks` below); every other row offers **Reissue**, which mints a
 * fresh token, kills the old one, and reveals the new link here.
 *
 * That is not a limitation to design around: it is the property that makes
 * a leaked database useless, and the desk already knows the rule from the
 * issue modal ("this link is shown once").
 *
 * ## Times
 *
 * Expiry and last-opened read as a relative phrase first, because
 * "in 3 hours" is the number reception acts on, with the absolute
 * **Asia/Bangkok** time underneath for the phone call. Bangkok explicitly,
 * not the browser's zone: the desk is in Bangkok and so is every guest on
 * these links, and a laptop left on UTC must not shift a 12:00 expiry to
 * 05:00 on the screen someone reads out loud.
 */

const PAGE_SIZE = 20;

/** Only two filters, because the desk only asks two questions. */
type DepositLinkFilter = 'open' | 'all';

/**
 * Poll interval. Slips arrive from a guest's phone with nothing to push
 * them here — the deposit page has no session and so no SSE channel — and
 * `checking → confirmed` is the transition reception is waiting on.
 */
const POLL_INTERVAL_MS = 30_000;

const STATE_TONE: Record<DepositLinkState, BadgeTone> = {
  awaiting_payment: 'warning',
  checking: 'info',
  confirmed: 'success',
  expired: 'neutral',
  revoked: 'error',
};

/** A live link is one a guest could still pay against. */
const LIVE_STATES: readonly DepositLinkState[] = ['awaiting_payment', 'checking'];

export default function DepositLinkListPanel() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();

  const [filter, setFilter] = useState<DepositLinkFilter>('open');
  const [page, setPage] = useState(1);

  /**
   * Links minted in this browser session, keyed by link id. The only rows
   * whose plain URL exists anywhere — see the note at the top of the file.
   */
  const [sessionLinks, setSessionLinks] = useState<Record<string, IssuedDepositLink>>({});
  /** The link whose URL is currently on screen; a reissue replaces it. */
  const [revealedLinkId, setRevealedLinkId] = useState<string | null>(null);
  /**
   * The row a revoke is being confirmed for.
   *
   * A dialog rather than `window.confirm`: revoke is destructive and
   * irreversible — the guest's page stops working the moment it lands — and
   * a native confirm on the desk's tablet is an unstyled, untranslatable
   * box that some kiosk browsers suppress outright.
   */
  const [pendingRevoke, setPendingRevoke] = useState<DepositLinkListItem | null>(null);

  const listParams = useMemo(
    () => ({
      // The backend's `open` filter is exactly the two live states.
      ...(filter === 'open' ? ({ status: 'open' } as const) : {}),
      page,
      limit: PAGE_SIZE,
    }),
    [filter, page],
  );

  const linksQuery = useQuery({
    // Same prefix the issue modal invalidates, so a link issued there shows
    // up here without either component knowing about the other.
    queryKey: ['admin', 'deposit-links', listParams],
    queryFn: () => depositLinkService.listLinks(listParams),
    refetchInterval: POLL_INTERVAL_MS,
    refetchOnWindowFocus: true,
  });

  const links = linksQuery.data?.links ?? [];
  const total = linksQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const revealedLink = revealedLinkId ? (sessionLinks[revealedLinkId] ?? null) : null;

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'deposit-links'] });
  }, [queryClient]);

  const revokeMutation = useMutation({
    mutationFn: (linkId: string) => depositLinkService.revokeLink(linkId),
    onSuccess: (_result, linkId) => {
      // A revoked token is dead; keeping its URL on screen invites someone
      // to send it.
      setSessionLinks((previous) => {
        if (!(linkId in previous)) {
          return previous;
        }
        const next = { ...previous };
        delete next[linkId];
        return next;
      });
      setRevealedLinkId((current) => (current === linkId ? null : current));
      toast.success(t('depositLink.admin.list.revoked'));
      invalidate();
    },
    onError: (error: Error) => {
      logger.error('Deposit link revoke failed:', error.message);
      toast.error(t('depositLink.admin.list.revokeFailed'));
    },
  });

  const reissueMutation = useMutation({
    mutationFn: (linkId: string) => depositLinkService.reissueLink(linkId),
    onSuccess: (link, previousLinkId) => {
      setSessionLinks((previous) => {
        const next = { ...previous, [link.linkId]: link };
        // The old token died inside the reissue transaction.
        delete next[previousLinkId];
        return next;
      });
      setRevealedLinkId(link.linkId);
      toast.success(t('depositLink.admin.list.reissued'));
      invalidate();
    },
    onError: (error: Error) => {
      logger.error('Deposit link reissue failed:', error.message);
      toast.error(t('depositLink.admin.list.reissueFailed'));
    },
  });

  const handleCopy = useCallback(
    (link: IssuedDepositLink) => {
      void (async () => {
        try {
          await navigator.clipboard.writeText(link.url);
          toast.success(t('depositLink.admin.issued.copied'));
        } catch (error) {
          logger.error(
            'Failed to copy the deposit link:',
            error instanceof Error ? error.message : String(error),
          );
          toast.error(t('depositLink.admin.issued.copyFailed'));
        }
      })();
    },
    [t],
  );

  const confirmRevoke = useCallback(() => {
    if (!pendingRevoke) {
      return;
    }
    revokeMutation.mutate(pendingRevoke.linkId);
    setPendingRevoke(null);
  }, [pendingRevoke, revokeMutation]);

  const handleFilterChange = useCallback((value: string) => {
    setFilter(value === 'all' ? 'all' : 'open');
    setPage(1);
  }, []);

  const StateBadge = useCallback(
    ({ state }: { state: DepositLinkState }) => (
      <Badge tone={STATE_TONE[state] ?? 'neutral'} data-testid={`deposit-link-state-${state}`}>
        {t(`depositLink.state.${state}`)}
      </Badge>
    ),
    [t],
  );

  const ExpiryCell = useCallback(
    ({ row }: { row: DepositLinkListItem }) => (
      <div>
        <p className="text-caption text-ink">
          {formatRelativeTime(row.expiresAt, i18n.language) ?? '-'}
        </p>
        <p className="text-fine text-ink-muted">{formatBangkokDateTime(row.expiresAt) ?? '-'}</p>
      </div>
    ),
    [i18n.language],
  );

  const LastOpenedCell = useCallback(
    ({ row }: { row: DepositLinkListItem }) =>
      row.lastOpenedAt ? (
        <div>
          <p className="text-caption text-ink">
            {formatRelativeTime(row.lastOpenedAt, i18n.language) ?? '-'}
          </p>
          <p className="text-fine text-ink-muted">
            {formatBangkokDateTime(row.lastOpenedAt) ?? '-'}
          </p>
        </div>
      ) : (
        <span className="text-fine text-ink-faint" data-testid="deposit-link-never-opened">
          {t('depositLink.admin.list.neverOpened')}
        </span>
      ),
    [i18n.language, t],
  );

  const RowActions = useCallback(
    ({ row }: { row: DepositLinkListItem }) => {
      const held = sessionLinks[row.linkId] ?? null;
      const live = LIVE_STATES.includes(row.state);
      const busy = revokeMutation.isPending || reissueMutation.isPending;

      return (
        <div className="flex flex-wrap items-center gap-1">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!held}
            onClick={() => held && handleCopy(held)}
            title={
              held
                ? t('depositLink.admin.issued.copy')
                : t('depositLink.admin.list.linkNotHeld')
            }
            data-testid={`deposit-link-copy-${row.linkId}`}
          >
            <FiCopy className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">{t('depositLink.admin.issued.copy')}</span>
          </Button>

          {held ? (
            <a
              href={held.lineShareUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center gap-1 rounded-full border border-brand-600 px-3 text-fine font-semibold text-brand-700 hover:bg-brand-50"
              title={t('depositLink.admin.issued.shareLine')}
              data-testid={`deposit-link-share-${row.linkId}`}
            >
              <FiExternalLink className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">{t('depositLink.admin.issued.shareLine')}</span>
            </a>
          ) : null}

          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!live || busy}
            onClick={() => setPendingRevoke(row)}
            title={t('depositLink.admin.list.revoke')}
            data-testid={`deposit-link-revoke-${row.linkId}`}
          >
            <FiSlash className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">{t('depositLink.admin.list.revoke')}</span>
          </Button>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={row.state === 'confirmed' || busy}
            onClick={() => reissueMutation.mutate(row.linkId)}
            title={t('depositLink.admin.list.reissue')}
            data-testid={`deposit-link-reissue-${row.linkId}`}
          >
            <FiRotateCcw className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">{t('depositLink.admin.list.reissue')}</span>
          </Button>
        </div>
      );
    },
    [handleCopy, reissueMutation, revokeMutation.isPending, sessionLinks, t],
  );

  const columns: TableColumn<DepositLinkListItem>[] = [
    {
      key: 'guest',
      header: t('depositLink.admin.list.table.guest'),
      cell: (row) => (
        <div>
          <p className="text-body font-semibold text-ink">{row.guestName}</p>
          <p className="text-fine text-ink-muted">{t(`property.${row.property}`)}</p>
        </div>
      ),
    },
    {
      key: 'amount',
      header: t('depositLink.admin.list.table.amountDueNow'),
      align: 'right',
      cell: (row) => (
        <span className="font-semibold text-ink">
          {`${Number(row.amountDueNow).toLocaleString()} ${t('depositLink.currency')}`}
        </span>
      ),
    },
    {
      key: 'state',
      header: t('depositLink.admin.list.table.state'),
      cell: (row) => <StateBadge state={row.state} />,
    },
    {
      key: 'expiry',
      header: t('depositLink.admin.list.table.expiresAt'),
      cell: (row) => <ExpiryCell row={row} />,
    },
    {
      key: 'issued',
      header: t('depositLink.admin.list.table.issuedBy'),
      hideOnMobile: true,
      cell: (row) => (
        <div>
          <p className="text-caption text-ink">{row.issuedByName}</p>
          <p className="text-fine text-ink-muted">{formatBangkokDateTime(row.issuedAt) ?? '-'}</p>
        </div>
      ),
    },
    {
      key: 'lastOpened',
      header: t('depositLink.admin.list.table.lastOpenedAt'),
      hideOnMobile: true,
      cell: (row) => <LastOpenedCell row={row} />,
    },
    {
      key: 'actions',
      header: t('depositLink.admin.list.table.actions'),
      cell: (row) => <RowActions row={row} />,
    },
  ];

  const filterTabs: TabItem[] = [
    { value: 'open', label: t('depositLink.admin.list.filter.open') },
    { value: 'all', label: t('depositLink.admin.list.filter.all'), count: total },
  ];

  return (
    <Card className="space-y-6" data-testid="deposit-link-list-panel">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-title text-ink">{t('depositLink.admin.list.heading')}</h2>
          <p className="text-caption text-ink-muted">{t('depositLink.admin.list.subtitle')}</p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => linksQuery.refetch()}
          disabled={linksQuery.isRefetching}
          data-testid="deposit-link-refresh"
        >
          <FiRefreshCw
            className={`h-4 w-4 ${linksQuery.isRefetching ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          {t('common.refresh')}
        </Button>
      </div>

      <TabNav
        aria-label={t('depositLink.admin.list.heading')}
        items={filterTabs}
        value={filter}
        onChange={handleFilterChange}
      />

      {revealedLink && (
        <div className="space-y-2">
          <IssuedDepositLinkPanel link={revealedLink} />
          <div className="flex justify-end">
            {/* Reception's screen is a shared screen. Once the link is sent,
                the desk should be able to take it off the glass without
                reloading the page. */}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setRevealedLinkId(null)}
              data-testid="deposit-link-dismiss-revealed"
            >
              {t('depositLink.admin.issued.done')}
            </Button>
          </div>
        </div>
      )}

      {linksQuery.isError ? (
        <p role="alert" className="text-caption text-error-600" data-testid="deposit-link-list-error">
          {t('depositLink.admin.list.loadFailed')}
        </p>
      ) : null}

      <Table<DepositLinkListItem>
        aria-label={t('depositLink.admin.list.heading')}
        columns={columns}
        rows={links}
        rowKey={(row) => row.linkId}
        loading={linksQuery.isLoading}
        empty={<EmptyState title={t('depositLink.admin.list.empty')} />}
        mobileCard={(row) => (
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-body font-semibold text-ink">{row.guestName}</p>
                <p className="text-fine text-ink-muted">{t(`property.${row.property}`)}</p>
              </div>
              <StateBadge state={row.state} />
            </div>
            <div className="flex items-center justify-between text-caption text-ink-muted">
              <span>{t('depositLink.admin.list.table.expiresAt')}</span>
              <ExpiryCell row={row} />
            </div>
            <div className="flex items-center justify-between text-caption text-ink-muted">
              <span>{t('depositLink.admin.list.table.lastOpenedAt')}</span>
              <LastOpenedCell row={row} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-caption text-ink-muted">{row.issuedByName}</span>
              <span className="text-caption font-semibold text-ink">
                {`${Number(row.amountDueNow).toLocaleString()} ${t('depositLink.currency')}`}
              </span>
            </div>
            <div className="flex justify-end pt-1">
              <RowActions row={row} />
            </div>
          </div>
        )}
      />

      <Modal
        open={pendingRevoke !== null}
        onClose={() => setPendingRevoke(null)}
        size="sm"
        title={t('depositLink.admin.list.revoke')}
      >
        <div className="space-y-6">
          <p className="text-body text-ink" data-testid="deposit-link-revoke-confirm-body">
            {t('depositLink.admin.list.confirmRevoke', {
              guest: pendingRevoke?.guestName ?? '',
            })}
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setPendingRevoke(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={confirmRevoke}
              data-testid="deposit-link-revoke-confirm"
            >
              {t('depositLink.admin.list.revoke')}
            </Button>
          </div>
        </div>
      </Modal>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-caption text-ink-muted">
            {t('depositLink.admin.list.pagination', { current: page, total: totalPages })}
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page === 1}
            >
              {t('common.previous')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={page >= totalPages}
            >
              {t('common.next')}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
