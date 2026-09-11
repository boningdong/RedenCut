import { englishResources } from '../../shared/i18n/locales/en'

/** Actionable public availability failures; binary/model paths never enter this error. */
export class TranscriberUnavailableError extends Error {
  constructor(readonly reason: 'whisper-missing' | 'whisper-model-missing') {
    super(englishResources.errors[reason])
    this.name = 'TranscriberUnavailableError'
  }
}
