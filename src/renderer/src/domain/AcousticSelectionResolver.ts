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
      editable: selectedAcousticUnits.length > 0 && unalignedUnitIds.length === 0,
    }
  }
}
