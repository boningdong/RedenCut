import type { BrowserWindowConstructorOptions } from 'electron'
import type { HarnessWindowMode } from '../shared/harnessWindowMode'

export function harnessWindowOptions(
  mode: HarnessWindowMode | undefined,
): BrowserWindowConstructorOptions {
  if (!mode) return {}
  return {
    show: false,
    focusable: mode === 'foreground',
    webPreferences: { backgroundThrottling: false, focusOnNavigation: mode === 'foreground' },
  }
}

export function presentHarnessWindow(
  window: { showInactive(): void; show(): void },
  mode: HarnessWindowMode | undefined,
): void {
  if (mode === 'background') window.showInactive()
  if (mode === 'foreground') window.show()
}
