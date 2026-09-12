import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import AppShell from '../components/layout/AppShell';
import { Card } from '../components/ui';
import { pdpaContactEmail, pdpaContactHref } from '../utils/pdpaContact';
import { deskPhone, deskPhoneHref } from '../utils/deskContact';

/**
 * PDPA privacy notice (task F3). Publicly reachable (no auth) — linked from
 * the footer and, once task C1 lands, from the OA rich menus and footer.
 *
 * The copy comes from `docs/privacy/2026-09-pdpa-data-map.md` §9, which is
 * itself cited line by line to the code that does the processing. Three
 * things about the structure are deliberate:
 *
 * **Thai first, with an English section.** The app's default language is
 * Thai and the Thai text is the one guests act on, so the notice renders in
 * the reader's own language and then repeats itself in English *unless the
 * reader already chose English*. An English reader does not need the same
 * words twice; a Thai or Chinese reader benefits from having the English
 * available, because that is the version a lawyer or a bank will ask for.
 * `t(key, { lng: 'en' })` pulls the English strings out of the bundle that
 * is already loaded, so the English section costs no duplicated locale keys.
 *
 * **Retention numbers are marked as proposals.** F1 §10 Q1: the 90 days /
 * 5 years / 24 months / 12 months are proposals the owner has not yet
 * confirmed. Publishing them unmarked would state as policy something
 * nobody has decided; publishing nothing would leave the notice with the
 * blank PDPA s.23 does not allow. So they are published, and labelled.
 *
 * **The contact is a build-time variable, not a string in a locale file.**
 * F1 §10 Q2: "a rights request needs one address that is read". See
 * `utils/pdpaContact.ts`. Blank falls back to the desk phone rather than
 * rendering an empty contact section.
 */
export default function PrivacyPage() {
  const { t, i18n } = useTranslation();

  const contactEmail = pdpaContactEmail();
  const hfPhone = deskPhone('hf');
  const hfvillePhone = deskPhone('hfville');
  // The English block is redundant for a reader who already picked English.
  const showEnglishSection = !i18n.language?.startsWith('en');

  /** The retention list, in the order F1 §8 prioritises it. */
  const retentionKeys = [
    'retentionSlipImage',
    'retentionSlipMeta',
    'retentionBooking',
    'retentionMembership',
    'retentionSurvey',
    'retentionLine',
    'retentionNotify',
  ] as const;

  const slipKeys = ['slipBody1', 'slipBody2', 'slipBody3', 'slipBody4', 'slipBody5', 'slipBody6'] as const;

  /** The contact block, rendered identically in both language sections. */
  const renderContact = (tr: (key: string) => string) => (
    <>
      {contactEmail ? (
        <>
          <p className="text-body text-ink-muted">{tr('privacy.contactBody')}</p>
          <p className="mt-2">
            <a
              href={pdpaContactHref(contactEmail)}
              className="text-body text-brand-600 hover:underline"
              data-testid="pdpa-contact-email"
            >
              {contactEmail}
            </a>
          </p>
        </>
      ) : (
        <>
          <p className="text-body text-ink-muted" data-testid="pdpa-contact-fallback">
            {tr('privacy.contactFallback')}
          </p>
          <p className="mt-2 text-body text-ink">{tr('privacy.contactDesk')}</p>
          {(hfPhone !== null || hfvillePhone !== null) && (
            <ul className="mt-1 space-y-1">
              {hfPhone && (
                <li className="text-body">
                  <a href={deskPhoneHref(hfPhone)} className="text-brand-600 hover:underline">
                    {hfPhone}
                  </a>
                </li>
              )}
              {hfvillePhone && (
                <li className="text-body">
                  <a href={deskPhoneHref(hfvillePhone)} className="text-brand-600 hover:underline">
                    {hfvillePhone}
                  </a>
                </li>
              )}
            </ul>
          )}
        </>
      )}
      <p className="mt-3 text-body text-ink-muted">{tr('privacy.rightsWindow')}</p>
    </>
  );

  /** One complete rendering of the notice in whichever language `tr` reads. */
  const renderNotice = (tr: (key: string) => string) => (
    <div className="space-y-6">
      <Card>
        <p className="text-body text-ink-muted">{tr('privacy.intro')}</p>
        <p className="mt-3 text-body text-ink-muted">{tr('privacy.controller')}</p>
        <p className="mt-3 text-caption text-ink-faint">{tr('privacy.updated')}</p>
      </Card>

      <Card>
        <h2 className="mb-2 text-title text-ink">{tr('privacy.whatWeStoreTitle')}</h2>
        <p className="text-body text-ink-muted">{tr('privacy.whatWeStoreBody')}</p>
        <p className="mt-3 text-body text-ink-muted">{tr('privacy.whatWeStoreMore')}</p>
      </Card>

      <Card>
        <h2 className="mb-2 text-title text-ink">{tr('privacy.whyTitle')}</h2>
        <p className="text-body text-ink-muted">{tr('privacy.whyBody')}</p>
        <p className="mt-3 text-body text-ink-muted">{tr('privacy.whyMore')}</p>
      </Card>

      {/* The slip card. F1 §1: the payer on a slip is frequently not the
          guest, and this is the only card on the page about someone who
          never agreed to anything with us. */}
      <Card>
        <h2 className="mb-2 text-title text-ink">{tr('privacy.slipTitle')}</h2>
        <div className="space-y-3">
          {slipKeys.map((key) => (
            <p key={key} className="text-body text-ink-muted">
              {tr(`privacy.${key}`)}
            </p>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="mb-2 text-title text-ink">{tr('privacy.messagesTitle')}</h2>
        <p className="text-body text-ink-muted">{tr('privacy.messagesBody')}</p>
        <p className="mt-3 text-body text-ink-muted">{tr('privacy.messagesBlock')}</p>
      </Card>

      <Card>
        <h2 className="mb-2 text-title text-ink">{tr('privacy.retentionTitle')}</h2>
        <p className="text-body text-ink-muted">{tr('privacy.retentionProposalNote')}</p>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          {retentionKeys.map((key) => (
            <li key={key} className="text-body text-ink-muted">
              {tr(`privacy.${key}`)}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-body text-ink-muted">{tr('privacy.retentionAudit')}</p>
        <p className="mt-3 text-body text-ink-muted">{tr('privacy.retentionBackup')}</p>
      </Card>

      <Card>
        <h2 className="mb-2 text-title text-ink">{tr('privacy.rightsTitle')}</h2>
        <p className="text-body text-ink-muted">{tr('privacy.rightsBody')}</p>
        <p className="mt-3 text-body text-ink-muted">{tr('privacy.rightsMember')}</p>
        <p className="mt-3 text-body text-ink-muted">{tr('privacy.rightsNonMember')}</p>
        <p className="mt-3 text-body text-ink-muted">{tr('privacy.rightsErasureCaveat')}</p>
      </Card>

      {/* PDPA s.37(4): the 72-hour clock to the PDPC, and notice to the
          affected person when the risk is high. The runbook
          (docs/privacy/rights-path.md) is the operational other half. */}
      <Card>
        <h2 className="mb-2 text-title text-ink">{tr('privacy.breachTitle')}</h2>
        <p className="text-body text-ink-muted">{tr('privacy.breachBody')}</p>
      </Card>

      <Card>
        <h2 className="mb-2 text-title text-ink">{tr('privacy.contactTitle')}</h2>
        {renderContact(tr)}
      </Card>
    </div>
  );

  return (
    <AppShell variant="guest" title={t('privacy.title')}>
      <div className="mx-auto max-w-text space-y-6 pb-8">
        {renderNotice((key) => t(key))}

        {showEnglishSection && (
          <section aria-labelledby="privacy-english" className="space-y-6">
            <h2
              id="privacy-english"
              className="border-t border-hairline pt-6 text-title text-ink"
              data-testid="privacy-english-heading"
            >
              {t('privacy.englishTitle')}
            </h2>
            {renderNotice((key) => t(key, { lng: 'en' }))}
          </section>
        )}

        <div className="text-center">
          <Link to="/" className="text-brand-600 hover:underline">
            {t('privacy.backToApp')}
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
