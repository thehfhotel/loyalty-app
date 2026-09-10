import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';
import { FiCopy, FiExternalLink } from 'react-icons/fi';
import { Button, Card } from '../../components/ui';
import type { IssuedDepositLink } from '../../services/depositLinkService';
import { formatDateTimeToEuropean } from '../../utils/dateFormatter';
import { logger } from '../../utils/logger';

/**
 * The one and only sighting of a deposit-link token.
 *
 * The backend stores the SHA-256 of the token and nothing else, so this
 * panel is the last place the plain link exists. Reception copies it or
 * hands it straight to LINE; if it is lost the only cure is Reissue, which
 * mints a new token and kills this one.
 */
export default function IssuedDepositLinkPanel({ link }: { link: IssuedDepositLink }) {
  const { t } = useTranslation();

  const shareUrl = (link.lineShareUrl ?? '').trim().length > 0
    ? link.lineShareUrl
    // Fallback for a backend that has not filled the field in: the same
    // share intent the contract specifies, built here.
    : `https://line.me/R/share?text=${encodeURIComponent(
        `${t('depositLink.admin.issued.shareMessage')} ${link.url}`,
      )}`;

  const handleCopy = useCallback(() => {
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
  }, [link.url, t]);

  return (
    <Card surface="sunken" className="space-y-4" data-testid="issued-deposit-link">
      <div>
        <h3 className="text-title text-ink">{t('depositLink.admin.issued.heading')}</h3>
        <p className="text-caption text-warning-700">{t('depositLink.admin.issued.warning')}</p>
      </div>

      <div className="space-y-1">
        <p className="text-caption font-semibold text-ink">
          {t('depositLink.admin.issued.linkLabel')}
        </p>
        <p
          className="break-all rounded-lg border border-hairline bg-surface-card p-3 font-mono text-caption text-ink"
          data-testid="issued-deposit-link-url"
        >
          {link.url}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={handleCopy} data-testid="copy-deposit-link">
          <FiCopy className="h-4 w-4" aria-hidden="true" />
          {t('depositLink.admin.issued.copy')}
        </Button>
        <a
          href={shareUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-9 items-center gap-2 rounded-full border border-brand-600 px-4 text-caption font-semibold text-brand-700 hover:bg-brand-50"
          data-testid="share-deposit-link-line"
        >
          <FiExternalLink className="h-4 w-4" aria-hidden="true" />
          {t('depositLink.admin.issued.shareLine')}
        </a>
      </div>

      <dl className="grid grid-cols-2 gap-2 text-caption">
        <dt className="text-ink-muted">{t('depositLink.admin.issued.amountDueNow')}</dt>
        <dd className="text-right text-ink">{link.amountDueNow}</dd>
        <dt className="text-ink-muted">{t('depositLink.admin.issued.expiresAt')}</dt>
        <dd className="text-right text-ink">
          {formatDateTimeToEuropean(link.expiresAt) ?? link.expiresAt}
        </dd>
      </dl>
    </Card>
  );
}
