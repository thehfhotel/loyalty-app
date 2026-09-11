import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FiCopy, FiExternalLink, FiRefreshCw, FiRotateCcw, FiSearch, FiSlash, FiX } from 'react-icons/fi';
import { Badge, Button, Card, EmptyState, Input, Modal, TabNav, Table } from '../../components/ui';
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

/**
 * Digits and the punctuation Thai phone numbers are written with, four
 * characters or more — "081", "081-234-5678", "+66 81 234 5678". A guest
 * name never looks like this, in Thai or in English.
 */
const PHONE_SHAPED = /^[\d\s()+-]{4,}$/;

function looksLikePhone(query: string): boolean {
  return PHONE_SHAPED.test(query);
}

/**
 * The row an action is being confirmed for.
 *
 * Reissue shares this dialog with revoke: it revokes *every* live link on
 * the booking and moves the booking's hold, so to the guest holding the old
 * URL it is exactly as destructive as a revoke — and the two controls sit
 * side by side in the row. One unconfirmed click on an icon was enough to
 * kill the link of a guest who had already uploaded a slip.
 */
type PendingAction = { kind: 'revoke' | 'reissue'; row: DepositLinkListItem };

export interface DepositLinkListPanelProps {
  /**
   * False while the panel sits behind another tab. BookingManagement keeps
   * this component mounted across a surface switch (so the slip sidebar's
   * half-typed note survives), and a panel nobody can see must not keep
   * polling the list every 30 s.
   */
  active?: boolean;
  /**
   * A link minted elsewhere on this page in this browser session — the issue
   * modal's `onIssued`.
   *
   * The modal's create response is the only place the plain token ever
   * exists, and until this prop the panel never saw it: reception issued a
   * link, switched to this tab, and found Copy and LINE share greyed out on
   * the row they had just created, curable only by reloading the page (the
   * *one* thing that loses the token for good). Merged into `sessionLinks`
   * on arrival, so the row lights up the same way a reissue's does.
   *
   * Not revealed, only held: the modal has already shown this URL once, and
   * re-printing it under the table would leave a live payment credential on
   * a shared desk screen after reception had closed the dialog on it.
   */
  issuedLink?: IssuedDepositLink | null;
}

export default function DepositLinkListPanel({
  active = true,
  issuedLink = null,
}: DepositLinkListPanelProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();

  const [filter, setFilter] = useState<DepositLinkFilter>('open');
  const [page, setPage] = useState(1);
  /**
   * Guest-name search, applied in the browser over the page already loaded.
   *
   * Deliberately client-side: the list endpoint takes `status`, `page` and
   * `limit` and no search parameter, and at a desk issuing a handful of
   * links a day one page IS the list. The caption under the box says so
   * whenever there is more than one page, because "no rows" and "no rows on
   * this page" are the same picture and only one of them is an answer.
   */
  const [search, setSearch] = useState('');

  /**
   * Links minted in this browser session, keyed by link id. The only rows
   * whose plain URL exists anywhere — see the note at the top of the file.
   */
  const [sessionLinks, setSessionLinks] = useState<Record<string, IssuedDepositLink>>({});
  /** The link whose URL is currently on screen; a reissue replaces it. */
  const [revealedLinkId, setRevealedLinkId] = useState<string | null>(null);
  /**
   * The row a revoke or a reissue is being confirmed for.
   *
   * A dialog rather than `window.confirm`: both are destructive and
   * irreversible — the guest's page stops working the moment either lands —
   * and a native confirm on the desk's tablet is an unstyled, untranslatable
   * box that some kiosk browsers suppress outright.
   */
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

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
    refetchInterval: active ? POLL_INTERVAL_MS : false,
    refetchOnWindowFocus: active,
  });

  const links = useMemo(() => linksQuery.data?.links ?? [], [linksQuery.data]);
  const total = linksQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const revealedLink = revealedLinkId ? (sessionLinks[revealedLinkId] ?? null) : null;

  const query = search.trim().toLocaleLowerCase();
  const visibleLinks = useMemo(
    () =>
      query.length === 0
        ? links
        : // Guest name is the whole of the searchable text, because it is
          // the whole of what the row carries: `DepositLinkSummary`
          // (`routes/admin_deposit_links.rs`) has no phone field, so a
          // number typed here can never match — `looksLikePhone` below is
          // how the desk is told that rather than left staring at an empty
          // table. A row with no name (nullable on the wire) matches
          // nothing, which is the honest answer to "find Somchai".
          links.filter((row) => (row.guestName ?? '').toLocaleLowerCase().includes(query)),
    [links, query],
  );

  /**
   * True for a query that is plainly a phone number rather than a name.
   *
   * Reception's muscle memory is the phone number — it is what the guest
   * gave on the call and what the issue form asked for — so they will type
   * it here, and the list cannot answer. Saying why beats an empty table
   * that reads as "this guest has no link".
   */
  const searchingByPhone = query.length > 0 && looksLikePhone(query);

  /**
   * Merge a link minted by the issue modal into this session's token map.
   *
   * Identity-keyed on the prop, so a revoke that drops the link back out of
   * `sessionLinks` is not immediately undone by this effect: it re-runs only
   * when the parent hands over a *different* link.
   */
  useEffect(() => {
    if (!issuedLink) {
      return;
    }
    setSessionLinks((previous) =>
      previous[issuedLink.linkId] === issuedLink
        ? previous
        : { ...previous, [issuedLink.linkId]: issuedLink },
    );
  }, [issuedLink]);

  /**
   * The 30 s poll can shrink the result set under the desk's feet — a batch
   * of open links gets confirmed while reception is on page 3 — and a page
   * number past the end asks the backend for rows that do not exist, which
   * renders as "there are no deposit links at all". Follow the data back.
   */
  useEffect(() => {
    // Only once a response is in hand: while the next page is in flight
    // there is no `data`, `total` reads 0, and clamping on that would bounce
    // the desk back to page 1 every time they pressed Next.
    if (linksQuery.data && page > totalPages) {
      setPage(totalPages);
    }
  }, [linksQuery.data, page, totalPages]);

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

  const confirmPendingAction = useCallback(() => {
    if (!pendingAction) {
      return;
    }
    if (pendingAction.kind === 'revoke') {
      revokeMutation.mutate(pendingAction.row.linkId);
    } else {
      reissueMutation.mutate(pendingAction.row.linkId);
    }
    setPendingAction(null);
  }, [pendingAction, reissueMutation, revokeMutation]);

  /**
   * `guestName` and `property` are nullable on the wire. A hole where the
   * guest's name should be is worst inside a destructive confirm — a dialog
   * that names nobody — so name the gap instead of rendering nothing.
   */
  const guestLabel = useCallback(
    (row: DepositLinkListItem) => row.guestName ?? t('depositLink.admin.list.unknownGuest'),
    [t],
  );

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

          {/* The two destructive controls carry their label in words, not
              as an icon plus an `sr-only` span: they sit next to each other,
              they do different irreversible things to the same guest's link,
              and reception aims at them mid-phone-call. */}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!live || busy}
            onClick={() => setPendingAction({ kind: 'revoke', row })}
            title={t('depositLink.admin.list.revoke')}
            data-testid={`deposit-link-revoke-${row.linkId}`}
          >
            <FiSlash className="h-4 w-4" aria-hidden="true" />
            <span>{t('depositLink.admin.list.revoke')}</span>
          </Button>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={row.state === 'confirmed' || busy}
            onClick={() => setPendingAction({ kind: 'reissue', row })}
            title={t('depositLink.admin.list.reissue')}
            data-testid={`deposit-link-reissue-${row.linkId}`}
          >
            <FiRotateCcw className="h-4 w-4" aria-hidden="true" />
            <span>{t('depositLink.admin.list.reissue')}</span>
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
          <p className="text-body font-semibold text-ink">{guestLabel(row)}</p>
          {row.property ? (
            <p className="text-fine text-ink-muted">{t(`property.${row.property}`)}</p>
          ) : null}
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

  // `total` is the total of the CURRENT query — the backend counts through
  // the same status filter as the page — so it belongs on whichever tab is
  // selected. Hung on "All" it read "ทั้งหมด 3" while 50 links existed,
  // and it was wrong in exactly the state the panel opens in.
  const filterTabs: TabItem[] = [
    {
      value: 'open',
      label: t('depositLink.admin.list.filter.open'),
      count: filter === 'open' ? total : undefined,
    },
    {
      value: 'all',
      label: t('depositLink.admin.list.filter.all'),
      count: filter === 'all' ? total : undefined,
    },
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

      {/* Guest search. No <form>: there is nothing to submit — the filter is
          applied on every keystroke in the browser — and a form here would
          reload the admin page on Enter, which is the one key reception
          presses after typing a name. */}
      <div className="space-y-2">
        <label className="sr-only" htmlFor="deposit-link-search">
          {t('depositLink.admin.list.searchLabel')}
        </label>
        <Input
          id="deposit-link-search"
          type="search"
          shape="pill"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('depositLink.admin.list.searchPlaceholder')}
          leadingIcon={<FiSearch aria-hidden="true" />}
          trailingSlot={
            search ? (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="mr-1 flex h-11 w-11 items-center justify-center rounded-full text-ink-faint hover:text-ink"
                data-testid="deposit-link-search-clear"
              >
                <FiX className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">{t('depositLink.admin.list.searchClear')}</span>
              </button>
            ) : undefined
          }
          data-testid="deposit-link-search"
        />
        {/* The list endpoint has no search parameter, so this filters the
            page already on screen. Silent on a single page, where that is a
            distinction without a difference; said out loud the moment there
            is a second page for a guest to be hiding on. */}
        {search.trim() && totalPages > 1 ? (
          <p className="text-fine text-ink-muted" data-testid="deposit-link-search-scope">
            {t('depositLink.admin.list.searchPageScope')}
          </p>
        ) : null}
        {searchingByPhone ? (
          <p className="text-fine text-warning-700" data-testid="deposit-link-search-no-phone">
            {t('depositLink.admin.list.searchNoPhone')}
          </p>
        ) : null}
      </div>

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

      {/* One statement about the data at a time. A failed load used to
          render the alert *above* an empty state reading "no deposit links
          yet" — the desk checking whether a guest's link is still live read
          the second sentence as fact. Rows that a failed refetch left on
          screen still show: they are real, just possibly stale. */}
      {linksQuery.isError && links.length === 0 ? null : (
        <Table<DepositLinkListItem>
          aria-label={t('depositLink.admin.list.heading')}
          columns={columns}
          rows={visibleLinks}
          rowKey={(row) => row.linkId}
          loading={linksQuery.isLoading}
          empty={
            // "Nothing matched" and "nothing exists" are the same picture and
            // a different instruction — the first one means keep looking.
            <EmptyState
              title={
                query.length > 0 && links.length > 0
                  ? t('depositLink.admin.list.searchEmpty')
                  : t('depositLink.admin.list.empty')
              }
            />
          }
          mobileCard={(row) => (
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-body font-semibold text-ink">{guestLabel(row)}</p>
                  {row.property ? (
                    <p className="text-fine text-ink-muted">{t(`property.${row.property}`)}</p>
                  ) : null}
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
      )}

      {/* The safe button is deliberately NOT `common.cancel`: in Thai that
          is "ยกเลิก", the same verb that opens "ยกเลิกลิงก์" (revoke). Two
          adjacent buttons both starting "ยกเลิก" is the one dialog the desk
          must not have to read twice. */}
      <Modal
        open={pendingAction !== null}
        onClose={() => setPendingAction(null)}
        size="sm"
        title={
          pendingAction?.kind === 'reissue'
            ? t('depositLink.admin.list.reissue')
            : t('depositLink.admin.list.revoke')
        }
      >
        <div className="space-y-6">
          {pendingAction?.kind === 'reissue' ? (
            <div className="space-y-2">
              <p className="text-body text-ink" data-testid="deposit-link-reissue-confirm-body">
                {t('depositLink.admin.list.confirmReissue', {
                  guest: guestLabel(pendingAction.row),
                })}
              </p>
              {/* A guest in `checking` has already transferred and uploaded
                  a slip that is sitting in the verify queue. Reissuing on
                  them revokes the link they are watching. */}
              {pendingAction.row.state === 'checking' ? (
                <p
                  className="text-caption font-semibold text-warning-700"
                  data-testid="deposit-link-reissue-checking-warning"
                >
                  {t('depositLink.admin.list.reissueCheckingWarning')}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-body text-ink" data-testid="deposit-link-revoke-confirm-body">
              {t('depositLink.admin.list.confirmRevoke', {
                guest: pendingAction ? guestLabel(pendingAction.row) : '',
              })}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setPendingAction(null)}
              data-testid="deposit-link-confirm-keep"
            >
              {t('depositLink.admin.list.keepLink')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={confirmPendingAction}
              data-testid={
                pendingAction?.kind === 'reissue'
                  ? 'deposit-link-reissue-confirm'
                  : 'deposit-link-revoke-confirm'
              }
            >
              {pendingAction?.kind === 'reissue'
                ? t('depositLink.admin.list.confirmReissueAction')
                : t('depositLink.admin.list.confirmRevokeAction')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* `page > 1` keeps Previous reachable after the list shrinks under a
          poll: without it the whole pager unmounts at totalPages === 1 and
          strands the desk on a page that no longer exists. */}
      {(totalPages > 1 || page > 1) && (
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
