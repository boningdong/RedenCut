import type { PublicMessage, TranscriptionProgress } from './publicMessages'
// ─────────────────────────────────────────────────────────────────────────────
// ITranscriber — Speech-to-Text abstraction
//
// All STT engines (Whisper.cpp, cloud APIs, etc.) implement this interface.
// The rest of the app never calls an engine directly — it always goes through
// ITranscriber. This means swapping engines is a config change, not a rewrite.
//
// Implementations live in src/main/transcriber/:
//   • WhisperTranscriber  — local whisper.cpp binary (Phase 2)
//   • (future) CloudTranscriber — e.g. OpenAI Whisper API, AssemblyAI
// ─────────────────────────────────────────────────────────────────────────────

import type { EngineProvenance } from './speech.types'

export type TranscriptionJobId = string & { readonly __brand: 'TranscriptionJobId' }
export type TranscriptionCancellationResult = 'cancelled' | 'not-found'

export interface TranscribeOptions {
  /**
   * BCP-47 language code, e.g. "en", "zh", "es".
   * If omitted, the engine auto-detects the language.
   */
  language?: string

  /**
   * Engine-specific model name or path.
   * For whisper.cpp: e.g. "base", "small", "medium".
   * If omitted, the implementation chooses a sensible default.
   */
  model?: string
}

export interface TranscriptionEvidenceToken {
  text: string
  sourceStart?: number
  sourceEnd?: number
  confidence?: number
}

export interface TranscriptionEvidenceSegment {
  text: string
  sourceStart?: number
  sourceEnd?: number
  tokens?: TranscriptionEvidenceToken[]
}

export interface TranscriptionResult {
  text: string
  detectedLanguage: string
  verbatimCapability: 'verbatim' | 'best-effort-verbatim'
  evidence: TranscriptionEvidenceSegment[]
  provenance: EngineProvenance
}

export interface ITranscriber {
  /** Human-readable name shown in the UI, e.g. "Whisper.cpp (local)". */
  readonly name: string

  /**
   * Returns true if the engine is available in the current environment.
   * Whisper.cpp checks that the binary and at least one model exist.
   * Should be fast (cached after first call).
   */
  isAvailable(): Promise<boolean>

  /**
   * Returns a structured, actionable public reason if the engine is unavailable.
   * Returns null if available.
   */
  unavailableReason(): Promise<PublicMessage | null>

  /**
   * Transcribes the given audio file.
   * Returns ordered verbatim text evidence. Timing evidence is diagnostic input,
   * not canonical alignment and must never be exposed as editable boundaries.
   * May take minutes for long files — callers should show a progress indicator.
   */
  transcribe(
    audioFilePath: string,
    options: TranscribeOptions,
    signal: AbortSignal,
    onProgress?: (status: TranscriptionProgress) => void,
  ): Promise<TranscriptionResult>
}
