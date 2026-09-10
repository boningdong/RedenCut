interface AcousticRange {
  id: string
  sourceStart: number
  sourceEnd: number
}

interface AnonymousTurn {
  speakerLabel: string
  sourceStart: number
  sourceEnd: number
}

interface NormalizedSpeaker {
  id: string
  diarizationLabel: string
  defaultDisplayName: string
}

interface Attribution {
  acousticEditUnitId: string
  speakerId?: string
  candidateSpeakerIds?: string[]
  confidence?: number
  ambiguous: boolean
}

export function attributeSpeakers(
  acousticUnits: AcousticRange[],
  turns: AnonymousTurn[],
  createId: () => string,
): { speakers: NormalizedSpeaker[]; attributions: Attribution[] } {
  const labelOrder: string[] = []
  for (const turn of [...turns].sort((left, right) => left.sourceStart - right.sourceStart))
    if (!labelOrder.includes(turn.speakerLabel)) labelOrder.push(turn.speakerLabel)
  const speakers = labelOrder.map((diarizationLabel, index) => ({
    id: createId(),
    diarizationLabel,
    defaultDisplayName: `Speaker ${index + 1}`,
  }))
  const speakerByLabel = new Map(speakers.map((speaker) => [speaker.diarizationLabel, speaker]))
  const attributions = acousticUnits.map((unit): Attribution => {
    const overlapBySpeaker = new Map<string, number>()
    for (const turn of turns) {
      const overlap = Math.max(
        0,
        Math.min(unit.sourceEnd, turn.sourceEnd) - Math.max(unit.sourceStart, turn.sourceStart),
      )
      if (overlap > 0)
        overlapBySpeaker.set(
          turn.speakerLabel,
          (overlapBySpeaker.get(turn.speakerLabel) ?? 0) + overlap,
        )
    }
    if (overlapBySpeaker.size === 0)
      return { acousticEditUnitId: unit.id, ambiguous: false }
    const maximum = Math.max(...overlapBySpeaker.values())
    const candidateSpeakerIds = labelOrder
      .filter((label) => Math.abs((overlapBySpeaker.get(label) ?? 0) - maximum) < 1e-9)
      .map((label) => speakerByLabel.get(label)!.id)
    const confidence = Math.min(1, maximum / (unit.sourceEnd - unit.sourceStart))
    return candidateSpeakerIds.length === 1
      ? {
          acousticEditUnitId: unit.id,
          speakerId: candidateSpeakerIds[0],
          confidence,
          ambiguous: false,
        }
      : { acousticEditUnitId: unit.id, candidateSpeakerIds, confidence, ambiguous: true }
  })
  return { speakers, attributions }
}
