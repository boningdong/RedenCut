import { useState } from 'react'
import { useTranslation } from '../../i18n/useTranslation'
import { useLocaleStore } from '../../stores/locale.store'
import { PreferencesDialog } from '../settings/PreferencesDialog'
import { LocaleNotice } from '../LocaleNotice'
import { WelcomeStep } from './WelcomeStep'
import { PreparationStep } from './PreparationStep'
import { StartCreatingStep } from './StartCreatingStep'
export function OnboardingDialog({
  onStart,
}: {
  onStart: (kind: 'sample' | 'empty') => Promise<boolean>
}) {
  const { t } = useTranslation()
  const [step, setStep] = useState<'welcome' | 'prepare' | 'finish'>('welcome')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(false)
  const skip = () => {
    if (!pending) void useLocaleStore.getState().setOnboardingDisposition('skipped')
  }
  const start = async (kind: 'sample' | 'empty') => {
    setPending(true)
    setError(false)
    try {
      if (await onStart(kind)) await useLocaleStore.getState().setOnboardingDisposition('completed')
    } catch {
      setError(true)
    } finally {
      setPending(false)
    }
  }
  return (
    <PreferencesDialog
      className={step === 'welcome' ? 'welcome' : 'setup'}
      label={t('settings.welcome')}
      onClose={skip}
    >
      {step === 'welcome' ? (
        <WelcomeStep onSkip={skip} onContinue={() => setStep('prepare')} />
      ) : (
        <div className="setup-content">
          {step === 'prepare' ? (
            <PreparationStep onSkip={skip} onContinue={() => setStep('finish')} />
          ) : (
            <StartCreatingStep
              pending={pending}
              onStart={(kind) => void start(kind)}
              onBack={() => setStep('prepare')}
              onSkip={skip}
            />
          )}
        </div>
      )}
      <LocaleNotice />
      {error && (
        <p className="error-message" role="alert">
          {t('settings.startFailed')}
        </p>
      )}
    </PreferencesDialog>
  )
}
