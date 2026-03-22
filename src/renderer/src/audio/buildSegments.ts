// ─────────────────────────────────────────────────────────────────────────────
// buildSegmentsForSource
//
// Pure function: given a source file ID, a start time, and the current track
// model, produces an ordered list of "segments" that the decode loop must
// process for that source.
//
// A Segment is either:
//   • A real audio range  (muted: false) — fetch bytes [startByte, endByte] and decode
//   • A silence range     (muted: true)  — push silence for durationSecs
//
// Muted clips are INCLUDED (not skipped) so that the AudioWorklet FIFO stays
// time-aligned with the hardware clock.  If they were omitted, subsequent
// unmuted audio would arrive ahead of schedule and desync the cursor.
//
// Extracted from WebCodecsPlayer as a standalone function so it can be
// unit-tested without any browser API dependencies.
// ─────────────────────────────────────────────────────────────────────────────

import type { Track } from '@shared/project.types'
import type { FrameEntry } from './FrameIndex'

// ── Public types ──────────────────────────────────────────────────────────────

export interface Segment {
  /** Byte offset of the first compressed byte to fetch. 0 for muted segments. */
  startByte:    number
  /** Byte offset of the last byte to fetch (exclusive). 0 for muted segments. */
  endByte:      number
  /** Source-file presentation timestamp at segment start (seconds). */
  sourceStart:  number
  /** Output-timeline position at segment start (seconds). */
  outputStart:  number
  /** Whether this segment should output silence instead of decoded audio. */
  muted:        boolean
  /** Duration of this segment in seconds. */
  durationSecs: number
}

// ── Implementation ────────────────────────────────────────────────────────────

/**
 * Build the ordered segment list for a single source file.
 *
 * @param sourceId        ID of the source file to process
 * @param startTime       Output-timeline position to start from (seconds)
 * @param tracks          Current track model from timeline.store
 * @param seekFn          `index.seek(time) → FrameEntry` for this source
 * @param sourceDuration  Duration of the source file in seconds (for fallback)
 * @param fetchChunkSize  Byte chunk size appended to endByte to ensure a full last frame
 */
export function buildSegmentsForSource(
  sourceId:        string,
  startTime:       number,
  tracks:          Track[],
  seekFn:          (time: number) => FrameEntry,
  sourceDuration:  number,
  fetchChunkSize:  number,
): Segment[] {
  const anySolo = tracks.some((t) => t.solo)
  const segs: Segment[] = []

  // Track whether any clips for this source exist (even on muted/soloed tracks).
  // The fallback should only fire when NO clips are defined yet, not when
  // a track is muted — muted track should produce silence, not the full source.
  let hasClipsForSource = false

  for (const track of tracks) {
    if (track.clips.some((c) => c.sourceFileId === sourceId)) {
      hasClipsForSource = true
    }
    if (track.muted) continue
    if (anySolo && !track.solo) continue

    const sorted = [...track.clips].sort((a, b) => a.outputStart - b.outputStart)

    for (const clip of sorted) {
      if (clip.sourceFileId !== sourceId) continue

      const clipOutputEnd = clip.outputStart + (clip.sourceEnd - clip.sourceStart)
      if (clipOutputEnd <= startTime) continue

      // Where in this clip does playback start?
      const seekSourceTime = Math.max(
        clip.sourceStart,
        clip.sourceStart + (startTime - clip.outputStart),
      )

      if (clip.muted) {
        // Muted clip: include as silence so the worklet FIFO stays time-aligned
        segs.push({
          startByte:    0,
          endByte:      0,
          sourceStart:  seekSourceTime,
          outputStart:  clip.outputStart + (seekSourceTime - clip.sourceStart),
          muted:        true,
          durationSecs: clip.sourceEnd - seekSourceTime,
        })
        continue
      }

      const startFrame = seekFn(seekSourceTime)
      const endFrame   = seekFn(clip.sourceEnd)

      segs.push({
        startByte:    startFrame.byteOffset,
        endByte:      endFrame.byteOffset + fetchChunkSize,  // slightly past to capture last frame
        sourceStart:  startFrame.time,
        outputStart:  clip.outputStart + (startFrame.time - clip.sourceStart),
        muted:        false,
        durationSecs: clip.sourceEnd - startFrame.time,
      })
    }
  }

  // Fallback: no tracks/clips defined yet — decode the full source from startTime
  if (segs.length === 0) {
    if (!hasClipsForSource) {
      const startFrame = seekFn(startTime)
      return [{
        startByte:    startFrame.byteOffset,
        endByte:      Number.MAX_SAFE_INTEGER,
        sourceStart:  startFrame.time,
        outputStart:  startFrame.time,
        muted:        false,
        durationSecs: sourceDuration - startFrame.time,
      }]
    }
    // Clips exist but all tracks were muted/soloed out → pure silence
    // Compute how long this source contributes to the output timeline.
    // Use the furthest clip output-end across all tracks for this source.
    const outputEnd = tracks
      .flatMap((t) => t.clips)
      .filter((c) => c.sourceFileId === sourceId)
      .reduce((max, c) => Math.max(max, c.outputStart + (c.sourceEnd - c.sourceStart)), 0)
    return [{
      startByte:    0,
      endByte:      0,
      sourceStart:  startTime,
      outputStart:  startTime,
      muted:        true,
      durationSecs: Math.max(0, outputEnd - startTime),
    }]
  }

  // Sort segments by outputStart across all tracks/clips
  segs.sort((a, b) => a.outputStart - b.outputStart)

  // Insert silence segments for any gap between consecutive segments.
  // This keeps the AudioWorklet FIFO time-aligned when clips have been
  // repositioned with space between them.
  const withGaps: Segment[] = []
  let cursor = startTime
  for (const seg of segs) {
    const segStart = Math.max(seg.outputStart, startTime)
    if (segStart > cursor + 0.001) {
      withGaps.push({
        startByte:    0,
        endByte:      0,
        sourceStart:  0,
        outputStart:  cursor,
        muted:        true,
        durationSecs: segStart - cursor,
      })
    }
    withGaps.push(seg)
    cursor = segStart + seg.durationSecs
  }

  return withGaps
}
