interface TextUnit {
  id: string
  kind: 'speech' | 'punctuation'
}

interface AcousticUnit {
  id: string
  transcriptUnitIds: string[]
  sourceStart: number
  sourceEnd: number
}

export interface ResolvedAcousticSelection {
  requestedUnitIds: string[]
  resolvedUnitIds: string[]
  acousticEditUnitIds: string[]
  sourceRanges: Array<{ start: number; end: number }>
  expanded: boolean
  unalignedUnitIds: string[]
  editable: boolean
}

export class AcousticSelectionResolver {
  private readonly textById: Map<string, TextUnit>
  private readonly acousticByTranscript = new Map<string, AcousticUnit>()

  constructor(
    private readonly transcriptUnits: TextUnit[],
    private readonly acousticUnits: AcousticUnit[],
  ) {
    this.textById = new Map(transcriptUnits.map((unit) => [unit.id, unit]))
    for (const acousticUnit of acousticUnits)
      for (const transcriptUnitId of acousticUnit.transcriptUnitIds)
        this.acousticByTranscript.set(transcriptUnitId, acousticUnit)
  }

  resolve(inputIds: string[]): ResolvedAcousticSelection {
    const requestedUnitIds = [...new Set(inputIds)].filter((id) => this.textById.has(id))
    const requestedSpeechIds = requestedUnitIds.filter(
      (id) => this.textById.get(id)?.kind === 'speech',
    )
    const unalignedUnitIds = requestedSpeechIds.filter((id) => !this.acousticByTranscript.has(id))
    const canonicalSpeechIds = this.transcriptUnits
      .filter((unit) => requestedSpeechIds.includes(unit.id))
      .map((unit) => unit.id)
    const firstBoundary = this.acousticByTranscript.get(canonicalSpeechIds[0])
    const lastBoundary = this.acousticByTranscript.get(
      canonicalSpeechIds[canonicalSpeechIds.length - 1],
    )
    const canonicalAcousticUnits = canonicalSpeechIds.flatMap((id) => {
      const acoustic = this.acousticByTranscript.get(id)
      return acoustic ? [acoustic] : []
    })
    const validBoundaries =
      !!firstBoundary &&
      !!lastBoundary &&
      canonicalAcousticUnits.every(
        (unit, index) =>
          Number.isFinite(unit.sourceStart) &&
          Number.isFinite(unit.sourceEnd) &&
          unit.sourceEnd > unit.sourceStart &&
          (index === 0 ||
            (canonicalAcousticUnits[index - 1].sourceStart <= unit.sourceStart &&
              canonicalAcousticUnits[index - 1].sourceEnd <= unit.sourceEnd)),
      )
    const selectedAcousticIds = new Set(
      requestedSpeechIds.flatMap((id) => {
        const acoustic = this.acousticByTranscript.get(id)
        return acoustic ? [acoustic.id] : []
      }),
    )
    const selectedAcousticUnits = this.acousticUnits.filter((unit) =>
      selectedAcousticIds.has(unit.id),
    )
    const resolvedSet = new Set(selectedAcousticUnits.flatMap((unit) => unit.transcriptUnitIds))
    // Internal raw text belongs to this continuous selection even without its own timestamp.
    if (validBoundaries) for (const id of requestedSpeechIds) resolvedSet.add(id)
    const resolvedUnitIds = this.transcriptUnits
      .filter((unit) => resolvedSet.has(unit.id))
      .map((unit) => unit.id)
    const expanded = resolvedUnitIds.some((id) => !requestedSpeechIds.includes(id))
    return {
      requestedUnitIds,
      resolvedUnitIds,
      acousticEditUnitIds: selectedAcousticUnits.map((unit) => unit.id),
      sourceRanges: selectedAcousticUnits.map((unit) => ({
        start: unit.sourceStart,
        end: unit.sourceEnd,
      })),
      expanded,
      unalignedUnitIds,
      editable: selectedAcousticUnits.length > 0 && validBoundaries,
    }
  }
}
