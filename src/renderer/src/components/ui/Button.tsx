// ─────────────────────────────────────────────────────────────────────────────
// Button — base interactive element
//
// Uses CSS custom properties (design tokens) so it always matches the theme.
// Variants: 'primary' (accent fill), 'ghost' (transparent with border).
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost'
  size?: 'sm' | 'md'
}

export function Button({
  variant = 'ghost',
  size = 'md',
  children,
  style,
  ...props
}: ButtonProps) {
  const base: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    border: 'none',
    borderRadius: 6,
    cursor: props.disabled ? 'not-allowed' : 'pointer',
    fontFamily: 'var(--font-sans)',
    fontWeight: 500,
    letterSpacing: '0.01em',
    transition: 'background 0.1s, color 0.1s, opacity 0.1s',
    opacity: props.disabled ? 0.4 : 1,
    outline: 'none',
    WebkitAppRegion: 'no-drag' as string,  // prevent drag interference in title bar
    ...(size === 'sm'
      ? { fontSize: 'var(--text-xs)', padding: '4px 10px', height: 26 }
      : { fontSize: 'var(--text-sm)', padding: '6px 14px', height: 32 }),
    ...(variant === 'primary'
      ? {
          backgroundColor: 'var(--color-accent)',
          color: '#ffffff',
        }
      : {
          backgroundColor: 'var(--color-bg-elevated)',
          color: 'var(--color-text-primary)',
          border: '1px solid var(--color-border)',
        }),
    ...style,
  }

  return (
    <button style={base} {...props}>
      {children}
    </button>
  )
}
