// ── TimelineRuler ─────────────────────────────────────────────────────────────
// Uses the same pixel-per-second positions as clips at every zoom level.

interface TimelineRulerProps {
  duration: number
  pxPerSec: number
  scrollLeft: number
  viewportWidth: number
  empty?: boolean
}

export function TimelineRuler({
  duration,
  pxPerSec,
  empty,
  scrollLeft,
  viewportWidth,
}: TimelineRulerProps) {
  if (duration <= 0 || pxPerSec <= 0) return null

  // Fractional timecodes need more space, especially beyond one hour.
  const rawSec = pxPerSec >= 160 ? 80 / pxPerSec : Math.max(1, 40 / pxPerSec)
  const nice = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200, 3600]
  const interval = empty ? 5 : (nice.find((n) => n >= rawSec) ?? 3600)
  const step = interval < 1 ? interval / 2 : interval
  const first = Math.max(0, Math.floor(scrollLeft / pxPerSec / step) - 1)
  const last = Math.min(
    Math.floor(duration / step),
    Math.ceil((scrollLeft + viewportWidth) / pxPerSec / step),
  )
  // Integer indices avoid accumulated fractional errors at minute/hour boundaries.
  const ticks = Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => first + i)

  return (
    <>
      {ticks.map((index) => {
        const t = Math.round(index * step * 1000) / 1000
        const left = t * pxPerSec
        const major = interval >= 1 || index % 2 === 0
        const label =
          interval < 1
            ? formatPreciseTime(t)
            : t >= 3600
              ? `${Math.floor(t / 3600)}h${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}m`
              : t >= 60
                ? `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
                : `${t}s`
        return (
          <div
            key={index}
            style={{
              position: 'absolute',
              left,
              top: major ? 0 : '70%',
              bottom: 0,
              borderLeft: '1px solid var(--color-border-subtle)',
              paddingLeft: 3,
              display: 'flex',
              alignItems: 'flex-end',
              paddingBottom: 2,
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            {major && (
              <span style={{ fontSize: 9, color: 'var(--color-text-muted)' }}>{label}</span>
            )}
          </div>
        )
      })}
    </>
  )
}

function formatPreciseTime(seconds: number): string {
  const centiseconds = Math.round(seconds * 100)
  const second = `${Math.floor(centiseconds / 100) % 60}`.padStart(2, '0')
  const fraction = `${centiseconds % 100}`.padStart(2, '0')
  const minutes = Math.floor(centiseconds / 6000)
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${second}.${fraction}`
    : `${minutes}:${second}.${fraction}`
}
