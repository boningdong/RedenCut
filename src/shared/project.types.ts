// ─────────────────────────────────────────────────────────────────────────────
// Project Types & Zod Schemas
//
// This file is the single source of truth for the data model. Both the main
// process (Node.js) and the renderer (React) import from here.
//
// Zod serves two purposes:
//   1. Runtime validation when loading a .podcut.json file from disk
//   2. TypeScript type inference — we derive types FROM schemas, not separately
//
// Migration note: when the schema evolves, bump `version` and add a migration
// function in src/main/project/migrations.ts (to be created in Phase 2).
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod'

// ── Audio source ──────────────────────────────────────────────────────────────
export const AudioSourceSchema = z.object({
  /** Relative path to the original audio file — always in the same directory. */
  file: z.string(),
  /** SHA-256 of the audio file at the time of import. Used to detect moved/replaced files. */
  sha256: z.string().optional(),
  sampleRate: z.number(),
  channels: z.number(),
  durationSeconds: z.number(),
})
export type AudioSource = z.infer<typeof AudioSourceSchema>

// ── Transcript ────────────────────────────────────────────────────────────────
export const WordSchema = z.object({
  id: z.string(),
  text: z.string(),
  /** Start time in seconds within the original audio. */
  start: z.number(),
  /** End time in seconds within the original audio. */
  end: z.number(),
  /** Whisper confidence score 0–1. Optional — not all engines provide it. */
  confidence: z.number().optional(),
  /** Speaker label, e.g. "A", "B". Populated by diarization. */
  speaker: z.string().optional(),
  /**
   * True when the user has deleted this word (muted its audio region).
   * The word stays in the array — muted words are never removed — so undo/redo
   * and boundary adjustments remain possible.
   */
  muted: z.boolean().default(false),
})
export type Word = z.infer<typeof WordSchema>

export const SpeakerSchema = z.object({
  label: z.string(),   // display name, e.g. "Host", "Guest"
})

export const TranscriptSchema = z.object({
  engine: z.string(),   // e.g. "whisper.cpp", "assemblyai"
  model: z.string().optional(),
  words: z.array(WordSchema),
  speakers: z.record(z.string(), SpeakerSchema).default({}),
})
export type Transcript = z.infer<typeof TranscriptSchema>

// ── Edits ─────────────────────────────────────────────────────────────────────
// An Edit is a non-destructive instruction applied during export. The source
// audio is never modified; edits are metadata only.

export const EditTypeSchema = z.enum(['mute', 'cut'])
export type EditType = z.infer<typeof EditTypeSchema>

export const EditSchema = z.object({
  id: z.string(),
  type: EditTypeSchema,
  /** Start of the edit in seconds on the original timeline. */
  start: z.number(),
  /** End of the edit in seconds on the original timeline. */
  end: z.number(),
  /** Human-readable description, e.g. "removed tangent", "um". */
  label: z.string().optional(),
  /** How this edit was created: manually by the user, via text selection, or by a detector. */
  source: z.enum(['manual', 'text', 'filler_detect', 'plugin']).default('manual'),
})
export type Edit = z.infer<typeof EditSchema>

// ── Adjustments ───────────────────────────────────────────────────────────────
export const GainAdjustmentSchema = z.object({
  id: z.string(),
  type: z.literal('gain'),
  start: z.number(),
  end: z.number(),
  /** Gain in decibels. Negative = quieter, positive = louder. */
  valueDb: z.number(),
})

export const CrossfadeAdjustmentSchema = z.object({
  id: z.string(),
  type: z.literal('crossfade'),
  /** Position of the edit boundary where this crossfade is applied. */
  at: z.number(),
  /** Duration in milliseconds. Default: 30ms. */
  durationMs: z.number().default(30),
})

export const AdjustmentSchema = z.discriminatedUnion('type', [
  GainAdjustmentSchema,
  CrossfadeAdjustmentSchema,
])
export type Adjustment = z.infer<typeof AdjustmentSchema>

// ── Markers ───────────────────────────────────────────────────────────────────
export const MarkerSchema = z.object({
  id: z.string(),
  time: z.number(),
  type: z.enum(['jump_cut', 'note', 'todo']),
  label: z.string().optional(),
  severity: z.enum(['low', 'medium', 'high']).optional(),
  resolved: z.boolean().default(false),
})
export type Marker = z.infer<typeof MarkerSchema>

// ── Export settings ───────────────────────────────────────────────────────────
export const ExportSettingsSchema = z.object({
  /** Integrated loudness target in LUFS. Apple Podcasts / Spotify standard: -16. */
  targetLUFS: z.number().default(-16),
  /** True peak ceiling in dBTP. */
  truePeakDbTP: z.number().default(-1.5),
  format: z.enum(['mp3', 'wav', 'flac', 'aac']).default('mp3'),
  sampleRate: z.number().default(48000),
})
export type ExportSettings = z.infer<typeof ExportSettingsSchema>

// ── Plugin data ───────────────────────────────────────────────────────────────
// Plugins store their project-scoped data here. The key is the plugin's ID
// (e.g. "com.example.noise-reducer"). The host never inspects this data.
export const PluginDataSchema = z.record(z.string(), z.unknown())

// ── Project file (root) ───────────────────────────────────────────────────────
export const ProjectFileSchema = z.object({
  version: z.literal(1),
  createdAt: z.string(),           // ISO 8601
  source: AudioSourceSchema,
  transcript: TranscriptSchema.optional(),
  edits: z.array(EditSchema).default([]),
  adjustments: z.array(AdjustmentSchema).default([]),
  markers: z.array(MarkerSchema).default([]),
  export: ExportSettingsSchema.default({}),
  /** Plugin-contributed metadata. See addendum §3.3. */
  pluginData: PluginDataSchema.optional().default({}),
})
export type ProjectFile = z.infer<typeof ProjectFileSchema>

// ── Audio metadata (returned by FFprobe, not persisted in project file) ───────
export interface AudioMetadata {
  durationSeconds: number
  sampleRate: number
  channels: number
  codec: string
  bitrateKbps: number
}

// ── Peak data (generated by FFmpeg, cached as .peaks.json) ───────────────────
export interface PeakData {
  /** Array of channel arrays. Mono: one inner array. Stereo: two. */
  data: number[][]
  /** Total number of peak samples per channel. */
  length: number
  /** Duration in seconds — used to tell wavesurfer the audio length without decoding. */
  durationSeconds: number
}
