import type { Track } from '@shared/project.types'
import {
  findTranscriptOverlaps,
  type TranscriptOccurrence,
  type TranscriptOverlap,
} from './transcriptProjection'
export interface DialogueBlock {
  id: string
  units: TranscriptOccurrence[]
  overlaps: TranscriptOverlap[]
  start: number
}
interface AlignmentColumn {
  start: number
  end: number
  width: number
  units: TranscriptOccurrence[]
  continuingTrackIds: string[]
}
export interface AlignmentLine {
  columns: AlignmentColumn[]
}

/** Reading continuity is separate from the exact clip identity required for safe edits. */
export function dialogueScopes(
  units: TranscriptOccurrence[],
  tracks?: Track[],
): Map<string, string> {
  const scopes = new Map<string, string>()
  const records = [...new Map(units.map((unit) => [unit.scopeId, unit])).values()]
  for (const unit of records) scopes.set(unit.scopeId, unit.scopeId)
  const groups = new Map<string, typeof records>()
  for (const unit of records) {
    if (!unit.clip || !unit.analysis) continue
    const key = JSON.stringify([
      unit.track.id,
      unit.clip.audioSourceId,
      unit.analysis.analysisRevisionId,
    ])
    const group = groups.get(key) ?? []
    group.push(unit)
    groups.set(key, group)
  }
  for (const group of groups.values()) {
    const first = group[0]
    const clips = (
      tracks?.find((track) => track.id === first.track.id)?.clips ?? group.map((unit) => unit.clip)
    )
      .slice()
      .sort((a, b) => a.outputStart - b.outputStart)
    let previous: (typeof clips)[number] | undefined
    let scope: string | undefined
    for (const clip of clips) {
      const unit = group.find((candidate) => candidate.clip.id === clip.id)
      const continuous =
        previous &&
        previous.audioSourceId === clip.audioSourceId &&
        Math.abs(previous.sourceEnd - clip.sourceStart) < 1e-7 &&
        Math.abs(
          previous.outputStart + previous.sourceEnd - previous.sourceStart - clip.outputStart,
        ) < 1e-7
      if (!continuous) scope = undefined
      if (unit) {
        scope ??= unit.scopeId
        scopes.set(unit.scopeId, scope)
      }
      previous = clip
    }
  }
  return scopes
}

export function buildDialogueBlocks(
  units: TranscriptOccurrence[],
  tracks?: Track[],
): DialogueBlock[] {
  const scopes = dialogueScopes(units, tracks)
  const overlaps = findTranscriptOverlaps(units)
  let regions: Array<{ start: number; end: number; overlaps: TranscriptOverlap[] }> = []
  for (const overlap of overlaps) {
    const last = regions[regions.length - 1]
    if (last && last.end === overlap.start) {
      last.end = overlap.end
      last.overlaps.push(overlap)
    } else regions.push({ start: overlap.start, end: overlap.end, overlaps: [overlap] })
  }
  // Coarse acoustic context can bridge disjoint overlaps. Keep the true intervals, including gaps.
  for (const unit of units) {
    if (unit.muted || unit.outputStart === null || unit.outputEnd === null) continue
    const hits = regions
      .map((r, i) => (unit.outputStart! < r.end && unit.outputEnd! > r.start ? i : -1))
      .filter((i) => i >= 0)
    if (hits.length < 2) continue
    const first = hits[0],
      last = hits[hits.length - 1]
    regions = [
      ...regions.slice(0, first),
      {
        start: regions[first].start,
        end: regions[last].end,
        overlaps: regions.slice(first, last + 1).flatMap((r) => r.overlaps),
      },
      ...regions.slice(last + 1),
    ]
  }
  // Reading context may include a short boundary fragment; acoustic overlap remains exact.
  // Bound the whole extension so a chain of tiny units cannot consume a later paragraph.
  const contextRegion = new Map<string, number>()
  regions.forEach((region, index) => {
    const members = units.filter(
      (unit) =>
        !unit.muted &&
        unit.outputStart !== null &&
        unit.outputEnd !== null &&
        unit.outputStart < region.end &&
        unit.outputEnd > region.start,
    )
    for (const unit of units) {
      if (unit.muted || unit.outputStart === null || unit.outputEnd === null) continue
      const after = unit.outputStart >= region.end && unit.outputEnd <= region.end + 0.25
      const before = unit.outputEnd <= region.start && unit.outputStart >= region.start - 0.25
      if (!after && !before) continue
      if (
        regions.some(
          (candidate) => unit.outputStart! < candidate.end && unit.outputEnd! > candidate.start,
        )
      )
        continue
      const neighbor = members.find(
        (member) =>
          scopes.get(member.scopeId) === scopes.get(unit.scopeId) &&
          (member.speakerId ?? member.contextSpeakerId) ===
            (unit.speakerId ?? unit.contextSpeakerId) &&
          (after ? unit.outputStart! - member.outputEnd! : member.outputStart! - unit.outputEnd!) <=
            0.05,
      )
      if (neighbor) contextRegion.set(unit.id, index)
    }
  })
  for (const unit of units) {
    if (unit.muted || unit.outputStart !== null || unit.unit.kind !== 'punctuation') continue
    const anchor = units.find(
      (candidate) =>
        contextRegion.has(candidate.id) &&
        candidate.scopeId === unit.scopeId &&
        candidate.orderTime === unit.orderTime &&
        (candidate.speakerId ?? candidate.contextSpeakerId) ===
          (unit.speakerId ?? unit.contextSpeakerId),
    )
    if (anchor) contextRegion.set(unit.id, contextRegion.get(anchor.id)!)
  }
  const cards: DialogueBlock[] = regions.map((r) => ({
    id: '',
    units: [],
    overlaps: r.overlaps,
    start: r.start,
  }))
  const natural: DialogueBlock[] = []
  const previousByScope = new Map<string, { block: DialogueBlock; band: number }>()
  let lastAudibleScope: string | undefined
  for (const unit of units) {
    const scope = scopes.get(unit.scopeId)!
    // Suppressed or untimed interleaving is reading context, not evidence of a turn.
    // A different timed audible occurrence begins a real conversational turn.
    if (!unit.muted && unit.outputStart !== null && unit.outputEnd !== null) {
      if (lastAudibleScope !== undefined && lastAudibleScope !== scope)
        previousByScope.delete(lastAudibleScope)
      lastAudibleScope = scope
    }
    const hit = unit.muted
      ? -1
      : (contextRegion.get(unit.id) ??
        regions.findIndex((r) =>
          unit.outputStart !== null && unit.outputEnd !== null
            ? unit.outputStart < r.end && unit.outputEnd > r.start
            : unit.orderTime >= r.start && unit.orderTime < r.end,
        ))
    if (hit >= 0) {
      cards[hit].units.push(unit)
      previousByScope.delete(scope)
      continue
    }
    // Interleaved muted/solo-suppressed occurrences still form one source paragraph.
    // Region boundaries keep natural context on each side of a card separate.
    const band = regions.reduce(
      (count, region) =>
        count + Number(unit.orderTime >= region.start) + Number(unit.orderTime >= region.end),
      0,
    )
    const candidate = previousByScope.get(scope)
    const previous = candidate?.band === band ? candidate.block : undefined
    if (
      previous &&
      scopes.get(previous.units[previous.units.length - 1].scopeId) === scope &&
      (previous.units[previous.units.length - 1].speakerId ??
        previous.units[previous.units.length - 1].contextSpeakerId) ===
        (unit.speakerId ?? unit.contextSpeakerId) &&
      unit.orderTime - previous.units[previous.units.length - 1].orderTime < 2
    )
      previous.units.push(unit)
    else {
      const block = { id: unit.id, units: [unit], overlaps: [], start: unit.orderTime }
      previousByScope.set(scope, { block, band })
      natural.push(block)
    }
  }
  return [
    ...cards
      .filter((c) => c.units.length)
      .map((c) => ({
        ...c,
        id: `overlap:${c.units
          .map((u) => u.id)
          .sort()
          .join('|')}`,
      })),
    ...natural,
  ].sort((a, b) => a.start - b.start)
}

/** Shared columns are measured by their longest lane, never by fabricated text timing. */
export function layoutOverlapColumns(
  block: DialogueBlock,
  availableWidth: number,
  measure: (text: string) => number,
  tracks?: Track[],
): AlignmentLine[] {
  const scopes = dialogueScopes(block.units, tracks)
  const width = Math.max(40, availableWidth),
    assigned = new Set<string>(),
    columns: AlignmentColumn[] = []
  for (const interval of block.overlaps) {
    const anchors = [
      ...new Set([
        interval.start,
        ...block.units.flatMap((u) =>
          u.outputStart !== null && u.outputStart > interval.start && u.outputStart < interval.end
            ? [u.outputStart]
            : [],
        ),
      ]),
    ].sort((a, b) => a - b)
    for (let index = 0; index < anchors.length; index++) {
      const start = anchors[index],
        end = anchors[index + 1] ?? interval.end
      const selected = block.units.filter(
        (u) =>
          !assigned.has(u.id) &&
          (u.outputStart === null
            ? u.orderTime >= start && u.orderTime < end
            : u.outputStart < end && u.outputEnd! > start),
      )
      selected.forEach((u) => assigned.add(u.id))
      const continuingTrackIds = [
        ...new Set(
          block.units
            .filter(
              (u) =>
                u.outputStart !== null &&
                u.outputStart < start &&
                u.outputEnd! > start &&
                !selected.includes(u),
            )
            .map((u) => u.track.id),
        ),
      ]
      columns.push({
        start,
        end,
        width: 0,
        units: selected,
        continuingTrackIds,
      })
    }
  }
  // Reading context follows nearby speech without acquiring or changing acoustic timestamps.
  for (const unit of block.units.filter((u) => !assigned.has(u.id))) {
    let column = columns[0]
    for (const candidate of columns) if (candidate.start <= unit.orderTime) column = candidate
    column?.units.push(unit)
  }
  const lines: AlignmentLine[] = []
  let used = 0
  for (const column of columns) {
    const texts = new Map<string, string>()
    for (const unit of column.units) {
      const key = `${scopes.get(unit.scopeId)}:${unit.speakerId ?? unit.contextSpeakerId ?? ''}`
      texts.set(key, (texts.get(key) ?? '') + (unit.leadingSpace ? ' ' : '') + unit.unit.text)
    }
    column.width = Math.min(width, Math.max(8, ...[...texts.values()].map(measure)) + 4)
    if (!lines.length || used + column.width > width) {
      lines.push({ columns: [] })
      used = 0
    }
    lines[lines.length - 1].columns.push(column)
    used += column.width
  }
  return lines
}
