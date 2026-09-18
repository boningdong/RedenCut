import { useEffect, useRef, type ReactNode } from 'react'
import './preferences.css'
export function PreferencesDialog({
  children,
  className = '',
  onClose,
  label,
}: {
  children: ReactNode
  className?: string
  onClose: () => void
  label: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current!
    if (!dialog.open) dialog.showModal()
    return () => dialog.close()
  }, [])
  return (
    <dialog
      ref={ref}
      className={`preferences-dialog ${className}`}
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (
          event.key !== 'Escape' ||
          event.defaultPrevented ||
          event.nativeEvent.isComposing ||
          (event.target instanceof Element && event.target.closest('select'))
        )
          return
        event.preventDefault()
        onClose()
      }}
    >
      {children}
    </dialog>
  )
}
