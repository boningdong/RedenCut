import { useMemo, type ReactNode } from 'react'
import type { Track } from '@shared/project.types'
import { continuousTranscriptGroups } from '../../domain/ContinuousTranscriptGroups'
import type { TranscriptOccurrence } from '../../domain/transcriptProjection'

/** Preserve occurrence identity and timeline order; speaker attribution only changes presentation. */
export function ContinuousTranscript({
  units,
  tracks,
  renderUnit,
}: {
  tracks: Track[]
  units: TranscriptOccurrence[]
  renderUnit: (unit: TranscriptOccurrence) => ReactNode
}) {
  const groups = useMemo(() => continuousTranscriptGroups(units, tracks), [units, tracks])
  return (
    <div className="transcript-continuous">
      {groups.map((group) => (
        <p key={group[0].id} className="transcript-words">
          {group.map(renderUnit)}
        </p>
      ))}
    </div>
  )
}
