import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { Badge, Button, Card, Textarea } from '../ui';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { formatDateToDDMMYYYY } from '../../utils/dateFormatter';
import { logger } from '../../utils/logger';
import {
  LIVE_STATUSES,
  REQUEST_KINDS,
  privacyService,
  type PrivacyRequest,
  type RequestKind,
  type RequestStatus,
} from '../../services/privacyService';

/**
 * "ข้อมูลของฉัน" — the member's own rights surface (task F3).
 *
 * F1 §8 gap 7 asks for a rights path with "a written turnaround (PDPA
 * s.30-s.32 default 30 days)" and "a log of requests". This is the guest
 * half: four buttons, one per right, and the status of everything already
 * asked.
 *
 * Two decisions worth stating:
 *
 * **Erasure gets a confirm dialog, the other three do not.** F1 §6: an
 * erase destroys the link between the member and their points, tier and
 * nights, and a later login with the same LINE or Google account creates a
 * *new* membership rather than restoring the old one. That is irreversible
 * in a way "please correct my surname" is not, and the copy has to say so
 * before the button is pressed.
 *
 * **A kind with a live request is disabled rather than hidden.** The
 * backend answers 409 for a duplicate, and a disabled button that says why
 * is a better answer than a button that produces an error — but hiding it
 * would leave the member wondering whether the request registered at all.
 */

const KIND_COPY: Record<RequestKind, { label: string; description: string }> = {
  access: { label: 'privacy.kindAccess', description: 'privacy.kindAccessDesc' },
  erasure: { label: 'privacy.kindErasure', description: 'privacy.kindErasureDesc' },
  rectification: {
    label: 'privacy.kindRectification',
    description: 'privacy.kindRectificationDesc',
  },
  objection: { label: 'privacy.kindObjection', description: 'privacy.kindObjectionDesc' },
};

const STATUS_COPY: Record<RequestStatus, { key: string; tone: 'brand' | 'gold' | 'success' | 'neutral' }> = {
  open: { key: 'privacy.statusOpen', tone: 'gold' },
  in_progress: { key: 'privacy.statusInProgress', tone: 'brand' },
  done: { key: 'privacy.statusDone', tone: 'success' },
  refused: { key: 'privacy.statusRefused', tone: 'neutral' },
};

/**
 * A short date, falling back to the raw string. `formatDateToDDMMYYYY`
 * answers `null` for anything it cannot parse, and a blank cell next to
 * "Answer due" would be worse than an unformatted timestamp.
 */
function shortDate(value: string): string {
  return formatDateToDDMMYYYY(value) ?? value;
}

export default function MyDataSection() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [selectedKind, setSelectedKind] = useState<RequestKind | null>(null);
  const [note, setNote] = useState('');
  const [confirmErasure, setConfirmErasure] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['privacy', 'my-requests'],
    queryFn: () => privacyService.listMyRequests(),
  });

  const requests: PrivacyRequest[] = data?.requests ?? [];
  const liveKinds = new Set(
    requests.filter((r) => LIVE_STATUSES.includes(r.status)).map((r) => r.kind),
  );

  const mutation = useMutation({
    mutationFn: ({ kind, text }: { kind: RequestKind; text: string }) =>
      privacyService.createRequest(kind, text),
    onSuccess: async () => {
      setSelectedKind(null);
      setNote('');
      setError(null);
      setCreated(true);
      await queryClient.invalidateQueries({ queryKey: ['privacy', 'my-requests'] });
    },
    onError: (err: unknown) => {
      // The backend's 409 has its own sentence; anything else gets the
      // generic line plus a way out (the front desk).
      if (axios.isAxiosError(err) && err.response?.status === 409) {
        setError(t('privacy.duplicateError'));
      } else {
        setError(t('privacy.genericError'));
      }
      if (err instanceof Error) {
        logger.error('privacy request failed', err.message);
      } else {
        logger.error('privacy request failed', String(err));
      }
    },
  });

  const submit = (kind: RequestKind) => {
    setCreated(false);
    mutation.mutate({ kind, text: note });
  };

  const startRequest = (kind: RequestKind) => {
    setError(null);
    setCreated(false);
    setSelectedKind(kind);
    setNote('');
  };

  return (
    <Card as="section" aria-labelledby="my-data-heading" className="mt-6">
      <h2 id="my-data-heading" className="mb-1 text-title text-ink">
        {t('privacy.myDataTitle')}
      </h2>
      <p className="text-body text-ink-muted">{t('privacy.myDataIntro')}</p>

      <div className="mt-4 space-y-3">
        {REQUEST_KINDS.map((kind) => {
          const hasLive = liveKinds.has(kind);
          const isSelected = selectedKind === kind;
          return (
            <div key={kind} className="rounded-lg border border-hairline p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-body font-semibold text-ink">{t(KIND_COPY[kind].label)}</p>
                  <p className="mt-1 text-caption text-ink-muted">
                    {t(KIND_COPY[kind].description)}
                  </p>
                </div>
                <Button
                  variant={kind === 'erasure' ? 'destructive' : 'secondary'}
                  size="sm"
                  disabled={hasLive || mutation.isPending}
                  onClick={() => startRequest(kind)}
                  data-testid={`privacy-request-${kind}`}
                >
                  {t('privacy.submit')}
                </Button>
              </div>

              {hasLive && (
                <p className="mt-2 text-caption text-ink-faint" data-testid={`privacy-open-${kind}`}>
                  {t('privacy.myDataOpen')}
                </p>
              )}

              {isSelected && (
                <div className="mt-3 border-t border-hairline pt-3">
                  <label
                    htmlFor={`privacy-note-${kind}`}
                    className="mb-1 block text-caption text-ink-muted"
                  >
                    {t('privacy.noteLabel')}
                  </label>
                  <Textarea
                    id={`privacy-note-${kind}`}
                    value={note}
                    maxLength={2000}
                    placeholder={t('privacy.notePlaceholder')}
                    onChange={(event) => setNote(event.target.value)}
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      variant={kind === 'erasure' ? 'destructive' : 'primary'}
                      size="sm"
                      loading={mutation.isPending}
                      disabled={mutation.isPending}
                      onClick={() =>
                        kind === 'erasure' ? setConfirmErasure(true) : submit(kind)
                      }
                      data-testid={`privacy-confirm-${kind}`}
                    >
                      {mutation.isPending ? t('privacy.submitting') : t('privacy.submit')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSelectedKind(null);
                        setNote('');
                      }}
                    >
                      {t('privacy.cancel')}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {created && (
        <p className="mt-4 text-body text-success-700" role="status" data-testid="privacy-created">
          {t('privacy.created')}
        </p>
      )}
      {error && (
        <p className="mt-4 text-body text-error-700" role="alert" data-testid="privacy-error">
          {error}
        </p>
      )}

      <div className="mt-6 border-t border-hairline pt-4">
        <h3 className="mb-2 text-body font-semibold text-ink">{t('privacy.myDataHistory')}</h3>
        {isLoading ? (
          <p className="text-caption text-ink-faint">{t('common.loading')}</p>
        ) : requests.length === 0 ? (
          <p className="text-caption text-ink-faint" data-testid="privacy-no-requests">
            {t('privacy.myDataNone')}
          </p>
        ) : (
          <ul className="space-y-3">
            {requests.map((request) => (
              <li key={request.id} className="rounded-lg bg-surface-sunken p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-body text-ink">{t(KIND_COPY[request.kind].label)}</span>
                  <Badge tone={STATUS_COPY[request.status].tone}>
                    {t(STATUS_COPY[request.status].key)}
                  </Badge>
                </div>
                <p className="mt-1 text-caption text-ink-faint">
                  {t('privacy.requestedAt')}: {shortDate(request.requestedAt)}
                  {LIVE_STATUSES.includes(request.status) && (
                    <>
                      {' · '}
                      {t('privacy.dueAt')}: {shortDate(request.dueAt)}
                    </>
                  )}
                </p>
                {request.resolutionNote && (
                  <p className="mt-2 text-caption text-ink-muted">
                    {t('privacy.resolutionNote')}: {request.resolutionNote}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* The one irreversible action on this card gets the one dialog. */}
      <ConfirmDialog
        isOpen={confirmErasure}
        title={t('privacy.kindErasure')}
        message={t('privacy.kindErasureDesc')}
        confirmText={t('privacy.submit')}
        cancelText={t('privacy.cancel')}
        variant="danger"
        onConfirm={() => {
          setConfirmErasure(false);
          submit('erasure');
        }}
        onCancel={() => setConfirmErasure(false)}
      />
    </Card>
  );
}
