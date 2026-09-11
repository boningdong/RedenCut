import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { TranscriptOccurrence } from '../../domain/transcriptProjection'
import {
  buildDialogueBlocks,
  dialogueScopes,
  layoutOverlapColumns,
  type DialogueBlock,
} from '../../domain/transcriptDialogue'
import { trackPresentationColor } from '../../themes/trackColors'
import { useSpeakerColors } from '../../hooks/useSpeakerColors'
import { speakerName, speakerKey } from '../../domain/speakerPresentation'

function timestamp(time: number): string {
  return `${Math.floor(time / 60)
    .toString()
    .padStart(2, '0')}:${(time % 60).toFixed(2).padStart(5, '0')}`
}
type RenderUnit = (unit: TranscriptOccurrence) => ReactNode
function lanes(units: TranscriptOccurrence[]) {
  const scopes = dialogueScopes(units)
  const rows = new Map<string, TranscriptOccurrence[]>()
  for (const unit of units) {
    const id = `${scopes.get(unit.scopeId)}:${unit.speakerId ?? unit.contextSpeakerId ?? 'unknown'}`
    const row = rows.get(id) ?? []
    row.push(unit)
    rows.set(id, row)
  }
  return [...rows.values()]
}
function Speaker({ unit }: { unit: TranscriptOccurrence }) {
  const colors = useSpeakerColors()
  const speaker = unit.speakerId ?? unit.contextSpeakerId
  const color = speaker
    ? colors.get(speakerKey(unit.analysis, speaker))
    : trackPresentationColor(unit.track.color)
  return (
    <div className="transcript-speaker" contentEditable={false}>
      <span className="transcript-speaker-dot" style={{ background: color }} />
      <div>
        <span>
          {speakerName(unit.analysis, unit.speakerId ?? unit.contextSpeakerId) ?? unit.track.name}
        </span>
        <small>
          {timestamp(unit.orderTime)} · {unit.track.name}
        </small>
        {unit.ambiguous && <small>Speaker uncertain · same track</small>}
      </div>
    </div>
  )
}
function ReadRows({
  units,
  renderUnit,
}: {
  units: TranscriptOccurrence[]
  renderUnit: RenderUnit
}) {
  return (
    <>
      {lanes(units).map((row) => (
        <div className="transcript-paragraph" key={row[0].id}>
          <Speaker unit={row[0]} />
          <div className="transcript-words">{row.map(renderUnit)}</div>
        </div>
      ))}
    </>
  )
}

function OverlapCard({
  block,
  renderUnit,
  currentTime,
}: {
  block: DialogueBlock
  renderUnit: RenderUnit
  currentTime: number
}) {
  const [aligned, setAligned] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)
  useEffect(() => {
    if (!ref.current || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width
      if (next) setWidth(next)
    })
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])
  const active = block.overlaps.some((o) => currentTime >= o.start && currentTime < o.end)
  const start = block.overlaps[0].start,
    end = block.overlaps[block.overlaps.length - 1].end
  const lines = useMemo(() => {
    const canvas = document.createElement('canvas')
    // jsdom has no canvas; actual browsers measure in the transcript's computed font.
    const context = typeof CanvasRenderingContext2D === 'undefined' ? null : canvas.getContext('2d')
    if (context)
      context.font = ref.current
        ? getComputedStyle(ref.current.querySelector('.transcript-words') ?? ref.current).font
        : '15px sans-serif'
    return layoutOverlapColumns(block, Math.max(40, width - 155), (text) =>
      context ? context.measureText(text).width : text.length * 8,
    )
  }, [block, width])
  return (
    <section
      className={`transcript-overlap${active ? ' is-live' : ''}`}
      aria-label="Simultaneous speech"
      data-overlap-start={start}
      data-overlap-end={end}
      ref={ref}
    >
      <div className="transcript-overlap-header" contentEditable={false}>
        <span>
          Simultaneous speech{' '}
          <small>
            {timestamp(start)}–{timestamp(end)}
          </small>
        </span>
        <div className="transcript-local-switch">
          <button aria-pressed={!aligned} onClick={() => setAligned(false)}>
            Read
          </button>
          <button aria-pressed={aligned} onClick={() => setAligned(true)}>
            Align
          </button>
        </div>
      </div>
      {aligned ? (
        <div className="transcript-aligned">
          {lanes(block.units).map((row) => (
            <div
              className="transcript-paragraph transcript-aligned-speaker"
              key={row[0].id}
              data-aligned-track={row[0].track.id}
            >
              <Speaker unit={row[0]} />
              <div className="transcript-aligned-lane">
                {lines.map((line, lineIndex) => (
                  <div
                    className="transcript-content-line"
                    key={lineIndex}
                    style={{
                      gridTemplateColumns: line.columns
                        .map((column) => `${column.width}px`)
                        .join(' '),
                    }}
                  >
                    {line.columns.map((column) => {
                      const selected = column.units.filter((unit) =>
                        row.some((item) => item.id === unit.id),
                      )
                      const boundary = selected.some(
                        (unit) =>
                          unit.outputStart !== null &&
                          !block.overlaps.some(
                            (interval) =>
                              unit.outputStart! >= interval.start &&
                              unit.outputEnd! <= interval.end,
                          ),
                      )
                      return (
                        <div
                          className="transcript-alignment-cell transcript-words"
                          key={column.start}
                          data-anchor-start={column.start}
                          data-anchor-end={column.end}
                        >
                          <small
                            className="transcript-column-time"
                            contentEditable={false}
                            title={timestamp(column.start)}
                          >
                            ·
                          </small>
                          {selected.map(renderUnit)}
                          {boundary && (
                            <small className="transcript-boundary-note" contentEditable={false}>
                              spans boundary
                            </small>
                          )}
                          {!selected.length &&
                            column.continuingTrackIds.includes(row[0].track.id) && (
                              <span
                                className="transcript-continuation"
                                contentEditable={false}
                                title="Earlier acoustic unit continues through this overlap"
                                aria-label="Speech continues"
                              >
                                ···
                              </span>
                            )}
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <ReadRows units={block.units} renderUnit={renderUnit} />
      )}
    </section>
  )
}
export function TranscriptDialogue({
  units,
  renderUnit,
  currentTime,
}: {
  units: TranscriptOccurrence[]
  renderUnit: RenderUnit
  currentTime: number
}) {
  const blocks = useMemo(() => buildDialogueBlocks(units), [units])
  return (
    <div className="transcript-dialogue">
      {blocks.map((block) =>
        block.overlaps.length ? (
          <OverlapCard
            key={block.id}
            block={block}
            renderUnit={renderUnit}
            currentTime={currentTime}
          />
        ) : (
          <ReadRows key={block.id} units={block.units} renderUnit={renderUnit} />
        ),
      )}
    </div>
  )
}
