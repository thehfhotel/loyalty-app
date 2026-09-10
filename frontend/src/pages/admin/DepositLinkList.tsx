import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FiRotateCw, FiSlash } from 'react-icons/fi';
import { Badge, Button, Card, EmptyState, Table } from '../../components/ui';
import type { BadgeTone, TableColumn } from '../../components/ui';
import {
  depositLinkService,
  isDepositLinkState,
  type DepositLinkListFilter,
  type DepositLinkListItem,
  type DepositLinkState,
  type IssuedDepositLink,
} from '../../services/depositLinkService';
import { deskSlipOkStatus, type SlipOkStatusValue } from '../../types/slipok';
import { formatDateTimeToEuropean } from '../../utils/dateFormatter';
import IssuedDepositLinkPanel from './IssuedDepositLinkPanel';

/**
 * The deposit links reception has issued (B1 §3).
 *
 * Read-mostly: a link's own token is never returned again, so the only
 * actions here are Revoke and Reissue. Reissue mints a new token and stamps
 * `revoked_at` on the old one, and the fresh link is shown once, in the same
 * panel the create modal uses.
 */

const STATE_TONE: Record<DepositLinkState, BadgeTone> = {
  awaiting_payment: 'warning',
  checking: 'info',
  confirmed: 'success',
  expired: 'neutral',
  revoked: 'error',
};

const FILTERS: DepositLinkListFilter[] = ['open', 'paid', 'expired', 'revoked'];

// The desk slip vocabulary is snake_case on the wire and camelCase in the
// i18n bundle; this is the same mapping `BookingManagement`'s badge uses,
// kept keyed by `SlipOkStatusValue` so a status added to the locked set
// breaks this build rather than showing the desk a blank badge.
const SLIPOK_STATUS_LABEL_KEY: Record<SlipOkStatusValue, string> = {
  verified: 'admin.booking.bookingManagement.slipStatus.verified',
  pending: 'admin.booking.bookingManagement.slipStatus.pending',
  shadow_pass: 'admin.booking.bookingManagement.slipStatus.shadowPass',
  manual: 'admin.booking.bookingManagement.slipStatus.manual',
  unavailable: 'admin.booking.bookingManagement.slipStatus.unavailable',
  failed: 'admin.booking.bookingManagement.slipStatus.failed',
  quota_exceeded: 'admin.booking.bookingManagement.slipStatus.quotaExceeded',
};

export default function DepositLinkList() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<DepositLinkListFilter | ''>('');
  const [reissued, setReissued] = useState<IssuedDepositLink | null>(null);

  const linksQuery = useQuery({
    queryKey: ['admin', 'deposit-links', { status: filter || undefined }],
    queryFn: () =>
      depositLinkService.listLinks(filter === '' ? {} : { status: filter }),
  });

  const invalidate = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['admin', 'deposit-links'] });
  }, [queryClient]);

  const revokeMutation = useMutation({
    mutationFn: (linkId: string) => depositLinkService.revokeLink(linkId),
    onSuccess: async () => {
      toast.success(t('depositLink.admin.list.revoked'));
      await invalidate();
    },
    onError: () => toast.error(t('depositLink.admin.errors.revokeFailed')),
  });

  const reissueMutation = useMutation({
    mutationFn: (linkId: string) => depositLinkService.reissueLink(linkId),
    onSuccess: async (link) => {
      setReissued(link);
      toast.success(t('depositLink.admin.list.reissued'));
      await invalidate();
    },
    onError: () => toast.error(t('depositLink.admin.errors.reissueFailed')),
  });

  const stateBadge = (state: DepositLinkState) =>
    isDepositLinkState(state) ? (
      <Badge tone={STATE_TONE[state]}>{t(`depositLink.state.${state}`)}</Badge>
    ) : (
      // A state this bundle predates still has to read as something at the
      // desk, so show the raw value rather than an empty cell.
      <Badge tone="neutral">{String(state)}</Badge>
    );

  const columns: TableColumn<DepositLinkListItem>[] = [
    {
      key: 'guest',
      header: t('depositLink.admin.list.guest'),
      cell: (link) => (
        <div>
          <p className="text-body font-semibold text-ink">{link.guestName}</p>
          <p className="text-fine text-ink-muted">{t(`property.${link.property}`)}</p>
        </div>
      ),
    },
    {
      key: 'amount',
      header: t('depositLink.admin.list.amount'),
      cell: (link) => link.amountDueNow,
    },
    {
      key: 'state',
      header: t('depositLink.admin.list.state'),
      cell: (link) => (
        <div className="flex flex-wrap items-center gap-2">
          {stateBadge(link.state)}
          {link.slipokStatus && (
            <Badge tone="neutral" size="sm">
              {t(SLIPOK_STATUS_LABEL_KEY[deskSlipOkStatus(link.slipokStatus)])}
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: 'expiresAt',
      header: t('depositLink.admin.list.expiresAt'),
      cell: (link) => formatDateTimeToEuropean(link.expiresAt) ?? link.expiresAt,
    },
    {
      key: 'issuedBy',
      header: t('depositLink.admin.list.issuedBy'),
      cell: (link) => (
        <div>
          <p className="text-caption text-ink">{link.issuedByName}</p>
          <p className="text-fine text-ink-muted">
            {formatDateTimeToEuropean(link.issuedAt) ?? link.issuedAt}
          </p>
        </div>
      ),
    },
    {
      key: 'actions',
      header: t('depositLink.admin.list.actions'),
      cell: (link) => (
        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={reissueMutation.isPending}
            onClick={() => reissueMutation.mutate(link.linkId)}
          >
            <FiRotateCw className="h-4 w-4" aria-hidden="true" />
            {t('depositLink.admin.list.reissue')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={link.state === 'revoked' || revokeMutation.isPending}
            onClick={() => revokeMutation.mutate(link.linkId)}
          >
            <FiSlash className="h-4 w-4" aria-hidden="true" />
            {t('depositLink.admin.list.revoke')}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <Card className="space-y-4" data-testid="deposit-link-list">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-title text-ink">{t('depositLink.admin.list.heading')}</h2>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant={filter === '' ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => setFilter('')}
          >
            {t('depositLink.admin.list.filterAll')}
          </Button>
          {FILTERS.map((value) => (
            <Button
              key={value}
              type="button"
              variant={filter === value ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setFilter(value)}
            >
              {t(`depositLink.admin.list.filter.${value}`)}
            </Button>
          ))}
        </div>
      </div>

      {reissued && <IssuedDepositLinkPanel link={reissued} />}

      {linksQuery.isError ? (
        <p role="alert" className="text-caption text-error-600">
          {t('depositLink.admin.errors.loadFailed')}
        </p>
      ) : (
        <Table<DepositLinkListItem>
          aria-label={t('depositLink.admin.list.heading')}
          columns={columns}
          rows={linksQuery.data?.links ?? []}
          rowKey={(link) => link.linkId}
          empty={<EmptyState title={t('depositLink.admin.list.empty')} />}
        />
      )}
    </Card>
  );
}
