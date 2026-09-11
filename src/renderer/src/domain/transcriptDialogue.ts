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
export function dialogueScopes(units: TranscriptOccurrence[]): Map<string, string> {
  const scopes = new Map<string, string>()
  const clips = [...new Map(units.map((unit) => [unit.scopeId, unit])).values()].sort(
    (a, b) => (a.clip?.outputStart ?? a.orderTime) - (b.clip?.outputStart ?? b.orderTime),
  )
  const previousBySource = new Map<string, TranscriptOccurrence>()
  for (const unit of clips) {
    scopes.set(unit.scopeId, unit.scopeId)
    if (!unit.clip || !unit.analysis) continue
    const key = JSON.stringify([
      unit.track.id,
      unit.clip.audioSourceId,
      unit.analysis.analysisRevisionId,
    ])
    const previous = previousBySource.get(key)
    if (
      previous &&
      Math.abs(previous.clip.sourceEnd - unit.clip.sourceStart) < 1e-7 &&
      Math.abs(
        previous.clip.outputStart +
          previous.clip.sourceEnd -
          previous.clip.sourceStart -
          unit.clip.outputStart,
      ) < 1e-7
    ) {
      scopes.set(unit.scopeId, scopes.get(previous.scopeId)!)
    }
    previousBySource.set(key, unit)
  }
  return scopes
}

export function buildDialogueBlocks(units: TranscriptOccurrence[]): DialogueBlock[] {
  const scopes = dialogueScopes(units)
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
    // Only suppressed interleaving may be skipped when joining natural text.
    // A different audible occurrence begins a real conversational turn.
    if (!unit.muted) {
      if (lastAudibleScope !== undefined && lastAudibleScope !== scope)
        previousByScope.delete(lastAudibleScope)
      lastAudibleScope = scope
    }
    const hit = unit.muted
      ? -1
      : regions.findIndex((r) =>
          unit.outputStart !== null && unit.outputEnd !== null
            ? unit.outputStart < r.end && unit.outputEnd > r.start
            : unit.orderTime >= r.start && unit.orderTime < r.end,
        )
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
): AlignmentLine[] {
  const scopes = dialogueScopes(block.units)
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
      const texts = new Map<string, string>()
      for (const unit of selected) {
        const key = `${scopes.get(unit.scopeId)}:${unit.speakerId ?? unit.contextSpeakerId ?? ''}`
        texts.set(key, (texts.get(key) ?? '') + (unit.leadingSpace ? ' ' : '') + unit.unit.text)
      }
      const contentWidth = Math.max(8, ...[...texts.values()].map(measure)) + 4
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
        width: Math.min(width, contentWidth),
        units: selected,
        continuingTrackIds,
      })
    }
  }
  // Untimed context in a natural gap follows its preceding speech without acquiring a timestamp.
  for (const unit of block.units.filter((u) => !assigned.has(u.id))) {
    let column = columns[0]
    for (const candidate of columns) if (candidate.start <= unit.orderTime) column = candidate
    column?.units.push(unit)
  }
  const lines: AlignmentLine[] = []
  let used = 0
  for (const column of columns) {
    if (!lines.length || used + column.width > width) {
      lines.push({ columns: [] })
      used = 0
    }
    lines[lines.length - 1].columns.push(column)
    used += column.width
  }
  return lines
}
