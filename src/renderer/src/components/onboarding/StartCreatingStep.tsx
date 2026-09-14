import { useTranslation } from '../../i18n/useTranslation'
import { Icon } from '../ui/Icon'
export function StartCreatingStep({
  onStart,
  onBack,
  onSkip,
  pending,
}: {
  onStart: (kind: 'sample' | 'empty') => void
  onBack: () => void
  onSkip: () => void
  pending: boolean
}) {
  const { t } = useTranslation()
  return (
    <>
      <div className="row">
        <div className="steps">
          <span>✓ {t('settings.welcomeStep')}</span>
          <span className="line" />
          <span>✓ {t('settings.prepareStep')}</span>
          <span className="line" />
          <span className="current">{t('settings.finishStep')}</span>
        </div>
        <div className="spacer" />
        <button className="icon" disabled={pending} onClick={onSkip} aria-label={t('common.close')}>
          <Icon name="close" />
        </button>
      </div>
      <div className="finish-mark">
        <Icon name="check" />
      </div>
      <h2 className="center">{t('settings.finish')}</h2>
      <p className="lead center">{t('settings.finishLead')}</p>
      <div className="finish-options">
        {(['sample', 'empty'] as const).map((kind) => (
          <button
            key={kind}
            className="finish-option"
            disabled={pending}
            onClick={() => onStart(kind)}
          >
            <Icon name={kind === 'sample' ? 'play' : 'folder'} />
            <b>{t(`settings.${kind}`)}</b>
            <small>{t(kind === 'sample' ? 'settings.sampleHelp' : 'settings.emptyHelp')}</small>
          </button>
        ))}
      </div>
      {pending && (
        <p className="center" role="status">
          {t('settings.starting')}
        </p>
      )}
      <p className="footnote center">{t('settings.optionalLater')}</p>
      <div className="center" style={{ marginTop: 20 }}>
        <button onClick={onBack} disabled={pending}>
          ← {t('settings.back')}
        </button>
      </div>
    </>
  )
}
