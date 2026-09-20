import type { Clip, TrackContent } from '@shared/ProjectTypes'
import {
  AcousticSelectionResolver,
  type ResolvedAcousticSelection,
} from './AcousticSelectionResolver'
import type { TranscriptOccurrence } from './transcriptProjection'
import { hasValidatedTiming } from './transcriptReliability'

export interface OccurrenceSelection extends ResolvedAcousticSelection {
  occurrence: TranscriptOccurrence
  clips: Clip[]
  occurrences: TranscriptOccurrence[]
  scopeConflict: boolean
}

function resolveSourceTranscriptSelection(
  units: TranscriptOccurrence[],
  tracks?: TrackContent[],
): OccurrenceSelection | null {
  const occurrence = units[0]
  if (!occurrence) return null
  const { analysis, clip, track } = occurrence
  const resolved = new AcousticSelectionResolver(
    analysis.transcript.units,
    analysis.alignment.acousticEditUnits,
  ).resolve(units.map((u) => u.unit.id))
  let scopeConflict = units.some((u) => u.scopeId !== occurrence.scopeId)
  let clips = [clip]
  if (
    scopeConflict &&
    track &&
    tracks &&
    units.every(
      (u) =>
        u.track.id === track.id &&
        u.analysis.audioSourceId === analysis.audioSourceId &&
        u.analysis.analysisRevisionId === analysis.analysisRevisionId &&
        u.clip.audioSourceId === clip.audioSourceId,
    )
  ) {
    const selectedClips = [...new Map(units.map((u) => [u.clip.id, u.clip])).values()].sort(
      (a, b) => a.outputStart - b.outputStart,
    )
    const first = selectedClips[0],
      last = selectedClips[selectedClips.length - 1]
    const current = tracks.find((t) => t.id === track.id)?.clips ?? []
    clips = current
      .filter(
        (c) =>
          c.outputStart < last.outputStart + last.sourceEnd - last.sourceStart &&
          c.outputStart + c.sourceEnd - c.sourceStart > first.outputStart,
      )
      .sort((a, b) => a.outputStart - b.outputStart)
    scopeConflict =
      clips.length === 0 ||
      clips[0].id !== first.id ||
      clips[clips.length - 1].id !== last.id ||
      selectedClips.some((c) => !clips.some((x) => x.id === c.id)) ||
      clips.some(
        (c, i) =>
          c.audioSourceId !== clip.audioSourceId ||
          (i > 0 &&
            (Math.abs(clips[i - 1].sourceEnd - c.sourceStart) > 1e-7 ||
              Math.abs(
                clips[i - 1].outputStart +
                  clips[i - 1].sourceEnd -
                  clips[i - 1].sourceStart -
                  c.outputStart,
              ) > 1e-7)),
      )
  }
  const resolvedIds = new Set(resolved.resolvedUnitIds)
  const indices = analysis.transcript.units.flatMap((u, i) => (resolvedIds.has(u.id) ? [i] : []))
  const skippedSpeech =
    indices.length > 0 &&
    analysis.transcript.units
      .slice(Math.min(...indices), Math.max(...indices) + 1)
      .some((u) => u.kind === 'speech' && !resolvedIds.has(u.id))
  const start = Math.max(
    Math.min(...resolved.sourceRanges.map((r) => r.start)),
    Math.min(...clips.map((c) => c.sourceStart)),
    units.every((u) => u.projectionBounds)
      ? Math.min(...units.map((u) => u.projectionBounds!.sourceStart))
      : -Infinity,
  )
  const end = Math.min(
    Math.max(...resolved.sourceRanges.map((r) => r.end)),
    Math.max(...clips.map((c) => c.sourceEnd)),
    units.every((u) => u.projectionBounds)
      ? Math.max(...units.map((u) => u.projectionBounds!.sourceEnd))
      : Infinity,
  )
  const crossesUnselected = analysis.alignment.acousticEditUnits.some(
    (a) =>
      a.sourceStart < end &&
      a.sourceEnd > start &&
      a.transcriptUnitIds.some((id) => !resolvedIds.has(id)),
  )
  scopeConflict ||= skippedSpeech || crossesUnselected
  return {
    ...resolved,
    occurrence,
    clips,
    occurrences: units,
    scopeConflict,
    editable: resolved.editable && !scopeConflict && hasValidatedTiming(analysis) && end > start,
    sourceRanges: end > start ? [{ start, end }] : [],
  }
}

/** Keep acoustic resolution in the recorded source, then map edits into Mix source time. */
export function resolveTranscriptSelection(
  units: TranscriptOccurrence[],
  tracks?: TrackContent[],
): OccurrenceSelection | null {
  const resolved = resolveSourceTranscriptSelection(units, tracks)
  if (!resolved || !units[0]?.replacement) return resolved
  const target = units[0].replacement
  const consistent = units.every(
    (unit) =>
      unit.replacement?.clip === target.clip &&
      unit.replacement?.sourceOffset === target.sourceOffset,
  )
  return {
    ...resolved,
    occurrence: { ...resolved.occurrence, track: target.track, clip: target.clip },
    clips: [target.clip],
    sourceRanges: resolved.sourceRanges.map((range) => ({
      start: range.start + target.sourceOffset,
      end: range.end + target.sourceOffset,
    })),
    scopeConflict: resolved.scopeConflict || !consistent,
    editable: resolved.editable && consistent,
  }
}
