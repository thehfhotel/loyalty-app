import React from 'react';
import { useTranslation } from 'react-i18next';
import { FiArchive } from 'react-icons/fi';
import { formatDateToDDMMYYYY } from '../utils/dateFormatter';

/**
 * What a slip looks like once its image has been erased under the retention
 * policy (task F2, `docs/privacy/2026-09-pdpa-data-map.md` §1).
 *
 * The backend nulls `slipUrl` / `imageUrl` when the sweep unlinks the file and
 * stamps `deletedAt`. Rendering the null into an `<img src>` would produce a
 * broken-image glyph and a reader who files a bug — so every surface that used
 * to show the picture shows this instead, and the actions that would open or
 * download it are not rendered at all.
 *
 * The payment record is deliberately untouched by the erase: amount, bank
 * reference and the verification decision are all still on the row. The second
 * line says so, because "the slip is gone" otherwise reads as "the evidence is
 * gone".
 */
export interface SlipErasedNoticeProps {
  /** ISO timestamp the image was erased, or `null` when the row simply never
   *  carried a URL (a legacy row). The wording differs between the two. */
  deletedAt?: string | null;
  className?: string;
  /** Compact variant for a thumbnail-sized slot. */
  compact?: boolean;
}

export const SlipErasedNotice: React.FC<SlipErasedNoticeProps> = ({
  deletedAt,
  className = '',
  compact = false,
}) => {
  const { t } = useTranslation();
  const formatted = formatDateToDDMMYYYY(deletedAt ?? null);

  // A row with no URL and no `deletedAt` was never erased — it simply has no
  // image. Saying "erased on <date>" there would be a false statement about
  // what happened to a guest's data.
  const headline = formatted
    ? t('payment.slipErased', { date: formatted })
    : t('payment.slipUnavailable');

  return (
    <div
      role="note"
      data-testid="slip-erased-notice"
      className={`flex h-full w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-hairline bg-surface-muted p-4 text-center ${className}`}
    >
      <FiArchive
        className={compact ? 'h-4 w-4 text-ink-faint' : 'h-6 w-6 text-ink-faint'}
        aria-hidden="true"
      />
      <p className={compact ? 'text-caption text-ink-muted' : 'text-body-sm text-ink-muted'}>
        {headline}
      </p>
      {!compact && formatted && (
        <p className="text-caption text-ink-faint">{t('payment.slipErasedNote')}</p>
      )}
    </div>
  );
};

export default SlipErasedNotice;
