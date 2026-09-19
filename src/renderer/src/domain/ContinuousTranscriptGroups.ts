import type { TrackContent } from '@shared/ProjectTypes'
import type { TranscriptOccurrence } from './transcriptProjection'
import { dialogueScopes } from './transcriptDialogue'

/** Keep overlapping tracks readable; speaker attribution never determines these boundaries. */
export function continuousTranscriptGroups(units: TranscriptOccurrence[], tracks?: TrackContent[]) {
  const scopes = dialogueScopes(units, tracks)
  const byScope = new Map<string, TranscriptOccurrence[]>()
  for (const unit of units) {
    const scope = scopes.get(unit.scopeId)!
    const row = byScope.get(scope) ?? []
    row.push(unit)
    byScope.set(scope, row)
  }
  const groups: TranscriptOccurrence[][] = []
  for (const row of byScope.values()) {
    let group: TranscriptOccurrence[] = []
    for (const unit of row) {
      const previous = group[group.length - 1]
      if (
        previous &&
        (unit.orderTime - (previous.outputEnd ?? previous.orderTime) >= 0.75 ||
          (previous.unit.kind === 'punctuation' && /[.!?。！？]/u.test(previous.unit.text)))
      )
        group = []
      if (!group.length) groups.push(group)
      group.push(unit)
    }
  }
  return groups.sort((a, b) => a[0].orderTime - b[0].orderTime)
}
