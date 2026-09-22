import { useEffect, useRef, type RefObject } from 'react'
import { useTranslation } from '../../i18n/useTranslation'

/** The horizontal pan control stays outside the vertically scrolling track list. */
export function TimelineScrollbar({
  viewport,
  contentWidth,
  viewportWidth,
  headerWidth,
}: {
  viewport: RefObject<HTMLDivElement | null>
  contentWidth: number
  viewportWidth: number
  headerWidth: number
}) {
  const { t } = useTranslation()
  const scrollbar = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = viewport.current
    const sync = () => {
      if (scrollbar.current && element) scrollbar.current.scrollLeft = element.scrollLeft
    }
    sync()
    element?.addEventListener('scroll', sync)
    return () => element?.removeEventListener('scroll', sync)
  }, [viewport, contentWidth, viewportWidth])
  return (
    <div
      ref={scrollbar}
      className="audio-horizontal-scrollbar"
      role="region"
      aria-label={t('waveform.timelinePan')}
      tabIndex={0}
      style={{
        marginLeft: headerWidth,
        width: viewportWidth,
        maxWidth: `calc(100% - ${headerWidth}px)`,
      }}
      onKeyDown={(event) => {
        if (
          !event.metaKey &&
          !event.ctrlKey &&
          [
            'ArrowLeft',
            'ArrowRight',
            'ArrowUp',
            'ArrowDown',
            'Home',
            'End',
            'PageUp',
            'PageDown',
            ' ',
          ].includes(event.key)
        )
          event.stopPropagation()
      }}
      onScroll={(event) => {
        if (viewport.current) viewport.current.scrollLeft = event.currentTarget.scrollLeft
      }}
    >
      <div style={{ width: contentWidth, height: 1 }} />
    </div>
  )
}
