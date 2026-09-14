import { create } from 'zustand'
import { useThemeStore } from './theme.store'
import type { AppPreferencesSnapshot } from '@shared/appPreferences.types'
import type { LocalePreference } from '@shared/i18n/locale.types'
import type { IElectronAPI } from '@shared/ipc.types'

interface LocaleState extends AppPreferencesSnapshot {
  hydrated: boolean
  pending: boolean
  error: { reason: 'load-preferences' | 'save-preferences' } | null
  hydrate: () => Promise<void>
  setLocale: (preference: LocalePreference) => Promise<void>
  setTheme: (theme: AppPreferencesSnapshot['themeId']) => Promise<void>
  setFeaturePreferences: (features: {
    textEditingEnabled?: boolean
    speakerRecognitionEnabled?: boolean
  }) => Promise<void>
  setOnboardingDisposition: (
    disposition: AppPreferencesSnapshot['onboardingDisposition'],
  ) => Promise<void>
  dispose: () => void
}

export function createLocaleStore(getApi: () => IElectronAPI['appPreferences']) {
  let unsubscribe: (() => void) | null = null
  let hydration: Promise<void> | null = null
  let saveQueue = Promise.resolve()
  let pendingCount = 0
  let lifecycle = 0

  return create<LocaleState>()((set, get) => {
    const apply = (snapshot: AppPreferencesSnapshot) => {
      if (snapshot.revision < get().revision) return
      set({ ...snapshot, error: null })
      useThemeStore.getState().setTheme(snapshot.themeId)
    }
    const save = (operation: () => Promise<AppPreferencesSnapshot>) => {
      const generation = lifecycle
      pendingCount += 1
      set({ pending: true, error: null })
      saveQueue = saveQueue.then(async () => {
        if (generation !== lifecycle) return
        try {
          const snapshot = await operation()
          if (generation === lifecycle) apply(snapshot)
        } catch {
          if (generation === lifecycle) set({ error: { reason: 'save-preferences' } })
        } finally {
          if (generation === lifecycle) {
            pendingCount -= 1
            set({ pending: pendingCount > 0 })
          }
        }
      })
      return saveQueue
    }
    return {
      themeId: 'dark',
      themePreferenceSet: false,
      textEditingEnabled: true,
      speakerRecognitionEnabled: true,
      onboardingDisposition: 'pending',
      preference: 'system',
      resolvedLocale: 'en',
      revision: -1,
      warning: null,
      hydrated: false,
      pending: false,
      error: null,
      hydrate: () => {
        if (hydration) return hydration
        const generation = lifecycle
        const revision = get().revision
        const api = getApi()
        if (!unsubscribe)
          unsubscribe = api.onChanged((snapshot) => {
            if (generation === lifecycle) apply(snapshot)
          })
        hydration = api
          .get()
          .then(async (snapshot) => {
            if (generation !== lifecycle) return
            apply(snapshot)
            const legacy = localStorage.getItem('theme')
            if (!snapshot.themePreferenceSet && (legacy === 'dark' || legacy === 'light')) {
              try {
                const migrated = await api.migrateTheme(legacy)
                if (generation === lifecycle) apply(migrated)
                localStorage.removeItem('theme')
              } catch {
                if (generation === lifecycle) set({ error: { reason: 'save-preferences' } })
              }
            }
          })
          .catch(() => {
            if (generation === lifecycle && get().revision === revision)
              set({ error: { reason: 'load-preferences' } })
          })
          .finally(() => {
            if (generation !== lifecycle) return
            set({ hydrated: true })
            hydration = null
          })
        return hydration
      },
      setLocale: (preference) => save(() => getApi().setLocale(preference)),
      setTheme: (theme) => save(() => getApi().setTheme(theme)),
      setFeaturePreferences: (features) => save(() => getApi().setFeaturePreferences(features)),
      setOnboardingDisposition: (value) => save(() => getApi().setOnboardingDisposition(value)),
      dispose: () => {
        lifecycle += 1
        unsubscribe?.()
        unsubscribe = null
        hydration = null
        pendingCount = 0
        set({ pending: false })
      },
    }
  })
}
export const useLocaleStore = createLocaleStore(() => window.electronAPI.appPreferences)
