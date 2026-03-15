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

import type { Transcript } from './project.types'

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
   * Returns an actionable error string if the engine is unavailable,
   * e.g. "whisper-cli not found. Install with: brew install whisper-cpp"
   * Returns null if available.
   */
  unavailableReason(): Promise<string | null>

  /**
   * Transcribes the given audio file.
   * Returns a Transcript with word-level timestamps.
   * May take minutes for long files — callers should show a progress indicator.
   */
  transcribe(audioFilePath: string, options?: TranscribeOptions): Promise<Transcript>
}
