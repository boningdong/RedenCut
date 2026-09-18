import * as fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import {
  LocalePreferenceSchema,
  ThemeIdSchema,
  OnboardingDispositionSchema,
  FeaturePreferencesSchema,
  type ThemeId,
  type OnboardingDisposition,
  type FeaturePreferences,
  StoredAppPreferencesSchema,
  type AppPreferencesSnapshot,
} from '../../shared/appPreferences.types'
import type { LocalePreference } from '../../shared/i18n/locale.types'
import { resolveLocale } from '../../shared/i18n/resolveLocale'

export class AppPreferencesStore {
  private readonly listeners = new Set<(snapshot: AppPreferencesSnapshot) => void>()

  subscribe(listener: (snapshot: AppPreferencesSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private writes: Promise<void> = Promise.resolve()
  private hydration: Promise<void> | null = null
  private snapshot: AppPreferencesSnapshot = {
    whisperModelId: 'transcription-default',
    themeId: 'dark',
    themePreferenceSet: false,
    textEditingEnabled: true,
    speakerRecognitionEnabled: true,
    onboardingDisposition: 'pending',
    preference: 'system',
    resolvedLocale: 'en',
    revision: 0,
    warning: null,
  }

  constructor(
    private readonly filePath: string,
    private readonly getSystemLanguages: () => readonly string[],
  ) {}

  getSnapshot(): AppPreferencesSnapshot {
    return { ...this.snapshot }
  }

  async read(): Promise<AppPreferencesSnapshot> {
    // A read observes all previously admitted writes, including failed writes.
    await this.writes
    await this.hydrate()
    return this.getSnapshot()
  }

  setLocale(input: LocalePreference): Promise<AppPreferencesSnapshot> {
    const parsed = LocalePreferenceSchema.safeParse(input)
    if (!parsed.success) return Promise.reject(parsed.error)
    return this.update({ preference: parsed.data })
  }

  setWhisperModel(whisperModelId: string): Promise<AppPreferencesSnapshot> {
    return this.update({ whisperModelId })
  }

  setTheme(input: ThemeId): Promise<AppPreferencesSnapshot> {
    return this.update({ themeId: ThemeIdSchema.parse(input), themePreferenceSet: true })
  }

  migrateTheme(input: ThemeId): Promise<AppPreferencesSnapshot> {
    return this.update({ themeId: ThemeIdSchema.parse(input), themePreferenceSet: true }, true)
  }

  setFeaturePreferences(input: FeaturePreferences): Promise<AppPreferencesSnapshot> {
    return this.update(FeaturePreferencesSchema.parse(input))
  }

  setOnboardingDisposition(input: OnboardingDisposition): Promise<AppPreferencesSnapshot> {
    return this.update({ onboardingDisposition: OnboardingDispositionSchema.parse(input) })
  }

  private update(
    patch: Partial<
      Pick<
        AppPreferencesSnapshot,
        | 'whisperModelId'
        | 'preference'
        | 'themeId'
        | 'themePreferenceSet'
        | 'textEditingEnabled'
        | 'speakerRecognitionEnabled'
        | 'onboardingDisposition'
      >
    >,
    migration = false,
  ): Promise<AppPreferencesSnapshot> {
    const operation = this.writes.then(async () => {
      await this.hydrate()
      if (migration && this.snapshot.themePreferenceSet) return this.getSnapshot()
      const next = { ...this.snapshot, ...patch }
      next.resolvedLocale = resolveLocale(
        next.preference,
        next.preference === 'system' ? this.getSystemLanguages() : [],
      )
      next.revision++
      next.warning = null
      await this.persist(next)
      this.snapshot = next
      for (const listener of this.listeners) listener(this.getSnapshot())
      return this.getSnapshot()
    })
    this.writes = operation.then(
      () => undefined,
      () => undefined,
    )
    return operation
  }

  private hydrate(): Promise<void> {
    if (!this.hydration) {
      this.hydration = this.load().catch((error: unknown) => {
        // Filesystem failures stay observable; a later request can retry loading.
        this.hydration = null
        throw error
      })
    }
    return this.hydration
  }

  private async load(): Promise<void> {
    let preference: LocalePreference = 'system'
    let stored: ReturnType<typeof StoredAppPreferencesSchema.parse> | undefined
    let warning: AppPreferencesSnapshot['warning'] = null
    let raw: string | undefined
    try {
      raw = await fs.readFile(this.filePath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (raw !== undefined) {
      let input: unknown
      try {
        input = JSON.parse(raw)
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error
        warning = 'invalid-preferences'
      }
      const parsed = StoredAppPreferencesSchema.safeParse(input)
      if (parsed.success) {
        stored = parsed.data
        preference = parsed.data.localePreference
      } else warning = 'invalid-preferences'
    }
    this.snapshot = {
      whisperModelId: stored?.whisperModelId ?? 'transcription-default',
      themeId: stored?.themeId ?? 'dark',
      themePreferenceSet: stored?.themeId !== undefined,
      textEditingEnabled: stored?.textEditingEnabled ?? true,
      speakerRecognitionEnabled: stored?.speakerRecognitionEnabled ?? true,
      onboardingDisposition: stored?.onboardingDisposition ?? 'pending',
      preference,
      resolvedLocale: resolveLocale(
        preference,
        preference === 'system' ? this.getSystemLanguages() : [],
      ),
      revision: 0,
      warning,
    }
  }

  private async persist(snapshot: AppPreferencesSnapshot): Promise<void> {
    const directory = dirname(this.filePath)
    await fs.mkdir(directory, { recursive: true })
    const temporary = join(directory, `.${basename(this.filePath)}.${randomUUID()}.tmp`)
    // Cleanup is safe only after this write exclusively creates its temporary file.
    const handle = await fs.open(temporary, 'wx', 0o600)
    try {
      try {
        await handle.writeFile(
          JSON.stringify(
            {
              version: 1,
              whisperModelId: snapshot.whisperModelId,
              localePreference: snapshot.preference,
              ...(snapshot.themePreferenceSet ? { themeId: snapshot.themeId } : {}),
              textEditingEnabled: snapshot.textEditingEnabled,
              speakerRecognitionEnabled: snapshot.speakerRecognitionEnabled,
              onboardingDisposition: snapshot.onboardingDisposition,
            },
            null,
            2,
          ) + '\n',
        )
      } finally {
        await handle.close()
      }
      await fs.rename(temporary, this.filePath)
    } catch (error) {
      try {
        await fs.rm(temporary, { force: true })
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'App preferences could not be saved or cleaned up.',
          { cause: cleanupError },
        )
      }
      throw error
    }
  }
}
