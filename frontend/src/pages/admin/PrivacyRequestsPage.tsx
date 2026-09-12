import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import AppShell from '../../components/layout/AppShell';
import { Badge, Button, Card, EmptyState, PageHeader, Skeleton, Textarea } from '../../components/ui';
import { logger } from '../../utils/logger';
import {
  LIVE_STATUSES,
  privacyService,
  type AdminPrivacyRequest,
  type RequestStatus,
  type ResolutionStatus,
} from '../../services/privacyService';

/**
 * The desk's PDPA rights queue (task F3).
 *
 * F1 §8 gap 7: the erasure mechanism exists, what was missing is "the
 * admin-facing route that invokes it and the request log around it". This
 * page is that log, read by whoever answers rights requests.
 *
 * Ordering is the backend's — oldest first — and it is not a preference:
 * the oldest request is the closest to its 30-day deadline, so reading
 * order and working order are the same thing. `overdue` is computed
 * server-side per row rather than stored, because a stored flag would need
 * a job to keep it true.
 *
 * Marking an erasure answered runs the real erase (the same
 * `services::account_deletion::erase_account` the member's own delete
 * runs), so the button carries a warning and the note field is not
 * optional.
 */

const KIND_LABEL: Record<string, string> = {
  access: 'privacy.kindAccess',
  erasure: 'privacy.kindErasure',
  rectification: 'privacy.kindRectification',
  objection: 'privacy.kindObjection',
};

const STATUS_LABEL: Record<RequestStatus, { key: string; tone: 'brand' | 'gold' | 'success' | 'neutral' }> = {
  open: { key: 'privacy.statusOpen', tone: 'gold' },
  in_progress: { key: 'privacy.statusInProgress', tone: 'brand' },
  done: { key: 'privacy.statusDone', tone: 'success' },
  refused: { key: 'privacy.statusRefused', tone: 'neutral' },
};

/** ISO timestamp → a readable local date-time, or the raw value. */
function stamp(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export default function PrivacyRequestsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [showAll, setShowAll] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'privacy', 'requests', showAll ? 'all' : 'open'],
    queryFn: () => privacyService.listRequests(showAll ? 'all' : 'open'),
  });

  const resolve = useMutation({
    mutationFn: ({
      id,
      status,
      note,
    }: {
      id: string;
      status: ResolutionStatus;
      note?: string;
    }) => privacyService.resolveRequest(id, status, note),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'privacy', 'requests'] });
    },
    onError: (err: unknown) => {
      // The backend's own words when it sent any — "This request is already
      // done and cannot be changed" beats a generic failure line.
      if (axios.isAxiosError(err)) {
        const data = err.response?.data as { message?: unknown } | undefined;
        if (typeof data?.message === 'string' && data.message.length > 0) {
          setError(data.message);
          return;
        }
      }
      setError(t('privacy.adminResolveError'));
      logger.error('privacy resolve failed', err instanceof Error ? err.message : String(err));
    },
  });

  /**
   * The export is handed over as a downloaded file rather than rendered:
   * it is the member's whole record, and a screen full of it invites a
   * screenshot into a chat app. A file the admin attaches to a reply is
   * the shape the runbook describes.
   */
  const download = async (request: AdminPrivacyRequest) => {
    try {
      setError(null);
      const payload = await privacyService.getExport(request.id);
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `pdpa-export-${request.id}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(t('privacy.adminExportError'));
      logger.error('privacy export failed', err instanceof Error ? err.message : String(err));
    }
  };

  const requests = data?.requests ?? [];

  return (
    <AppShell variant="admin" title={t('privacy.adminTitle')}>
      <div className="mx-auto max-w-page px-4 py-8 sm:px-6">
        <PageHeader
          density="admin"
          title={t('privacy.adminTitle')}
          subtitle={t('privacy.adminSubtitle')}
          backTo="/admin/loyalty"
        />

        <Card className="mb-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <Badge tone="gold">
                {t('privacy.adminOpenCount', { count: data?.openCount ?? 0 })}
              </Badge>
              {(data?.overdueCount ?? 0) > 0 && (
                <Badge tone="error" data-testid="privacy-overdue-count">
                  {t('privacy.adminOverdueCount', { count: data?.overdueCount ?? 0 })}
                </Badge>
              )}
            </div>
            <Button variant="utility" size="sm" onClick={() => setShowAll((value) => !value)}>
              {showAll ? t('privacy.adminShowOpen') : t('privacy.adminShowAll')}
            </Button>
          </div>
        </Card>

        {error && (
          <Card className="mb-6">
            <p className="text-body text-error-700" role="alert" data-testid="privacy-admin-error">
              {error}
            </p>
          </Card>
        )}

        {isLoading ? (
          <Card>
            <Skeleton className="h-24 w-full" />
          </Card>
        ) : requests.length === 0 ? (
          <EmptyState title={t('privacy.adminEmpty')} />
        ) : (
          <div className="space-y-4">
            {requests.map((request) => {
              const live = LIVE_STATUSES.includes(request.status);
              const note = notes[request.id] ?? '';
              const canClose = note.trim().length > 0;
              return (
                <Card key={request.id} as="section" data-testid={`privacy-row-${request.id}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-title text-ink">{t(KIND_LABEL[request.kind] ?? request.kind)}</p>
                      <p className="mt-1 text-caption text-ink-muted">
                        {t('privacy.adminMember')}:{' '}
                        {request.membershipId ?? request.userId}
                        {request.email ? ` · ${request.email}` : ''}
                      </p>
                      <p className="mt-1 text-caption text-ink-faint">
                        {t('privacy.requestedAt')}: {stamp(request.requestedAt)} ·{' '}
                        {t('privacy.dueAt')}: {stamp(request.dueAt)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {request.overdue && <Badge tone="error">{t('privacy.adminOverdue')}</Badge>}
                      <Badge tone={STATUS_LABEL[request.status].tone}>
                        {t(STATUS_LABEL[request.status].key)}
                      </Badge>
                    </div>
                  </div>

                  {request.note && (
                    <p className="mt-3 rounded-lg bg-surface-sunken p-3 text-body text-ink-muted">
                      {t('privacy.adminNote')}: {request.note}
                    </p>
                  )}

                  {request.resolutionNote && (
                    <p className="mt-3 text-body text-ink-muted">
                      {t('privacy.resolutionNote')}: {request.resolutionNote}
                    </p>
                  )}

                  {request.kind === 'access' && (
                    <div className="mt-4">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void download(request)}
                        data-testid={`privacy-export-${request.id}`}
                      >
                        {t('privacy.adminExport')}
                      </Button>
                      <p className="mt-1 text-fine text-ink-faint">{t('privacy.adminExportHint')}</p>
                    </div>
                  )}

                  {live && (
                    <div className="mt-4 border-t border-hairline pt-4">
                      {request.kind === 'erasure' && (
                        <p className="mb-2 text-caption text-error-700">
                          {t('privacy.adminErasureWarning')}
                        </p>
                      )}
                      <label
                        htmlFor={`resolution-${request.id}`}
                        className="mb-1 block text-caption text-ink-muted"
                      >
                        {t('privacy.adminResolutionNote')}
                      </label>
                      <Textarea
                        id={`resolution-${request.id}`}
                        value={note}
                        maxLength={2000}
                        placeholder={t('privacy.adminResolutionNoteHint')}
                        onChange={(event) =>
                          setNotes((previous) => ({
                            ...previous,
                            [request.id]: event.target.value,
                          }))
                        }
                      />
                      <div className="mt-2 flex flex-wrap gap-2">
                        {request.status === 'open' && (
                          <Button
                            variant="utility"
                            size="sm"
                            disabled={resolve.isPending}
                            onClick={() =>
                              resolve.mutate({ id: request.id, status: 'in_progress' })
                            }
                          >
                            {t('privacy.adminMarkInProgress')}
                          </Button>
                        )}
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={!canClose || resolve.isPending}
                          onClick={() =>
                            resolve.mutate({ id: request.id, status: 'done', note })
                          }
                          data-testid={`privacy-done-${request.id}`}
                        >
                          {t('privacy.adminMarkDone')}
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={!canClose || resolve.isPending}
                          onClick={() =>
                            resolve.mutate({ id: request.id, status: 'refused', note })
                          }
                        >
                          {t('privacy.adminRefuse')}
                        </Button>
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
