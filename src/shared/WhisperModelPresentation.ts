/** Display metadata for the supported persisted Whisper installation identities. */
export function whisperModelVariant(id: string): 'small' | 'medium' | 'large-v3' {
  switch (id) {
    case 'transcription-whisper-medium':
      return 'medium'
    case 'transcription-whisper-large-v3':
      return 'large-v3'
    default:
      return 'small'
  }
}
