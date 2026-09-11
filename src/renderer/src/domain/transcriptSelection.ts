import {
  AcousticSelectionResolver,
  type ResolvedAcousticSelection,
} from './AcousticSelectionResolver'
import type { TranscriptOccurrence } from './transcriptProjection'
export interface OccurrenceSelection extends ResolvedAcousticSelection {
  occurrence: TranscriptOccurrence
  scopeConflict: boolean
}
export function resolveTranscriptSelection(
  units: TranscriptOccurrence[],
): OccurrenceSelection | null {
  const occurrence = units[0]
  if (!occurrence) return null
  const scopeConflict = units.some((u) => u.scopeId !== occurrence.scopeId)
  const resolved = new AcousticSelectionResolver(
    occurrence.analysis.transcript.units,
    occurrence.analysis.alignment.acousticEditUnits,
  ).resolve(units.map((u) => u.unit.id))
  return {
    ...resolved,
    occurrence,
    scopeConflict,
    editable: resolved.editable && !scopeConflict,
    sourceRanges: resolved.sourceRanges
      .map((range) => ({
        start: Math.max(range.start, occurrence.clip.sourceStart),
        end: Math.min(range.end, occurrence.clip.sourceEnd),
      }))
      .filter((range) => range.end > range.start),
  }
}
