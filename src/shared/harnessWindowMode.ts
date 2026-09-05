export type HarnessWindowMode = 'background' | 'foreground'

export function parseHarnessWindowMode(value: unknown = 'background'): HarnessWindowMode {
  if (value === 'background' || value === 'foreground') return value
  throw new Error('INVALID_WINDOW_MODE: expected background or foreground')
}
