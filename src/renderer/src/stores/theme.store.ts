import { create } from 'zustand'
import { themeRegistry, type ThemeName } from '../themes/themeRegistry'
export type { ThemeName } from '../themes/themeRegistry'
export function applyTheme(name: ThemeName): void {
  const theme = themeRegistry.find((entry) => entry.id === name) ?? themeRegistry[0]
  const root = document.documentElement
  root.dataset.theme = theme.id
  root.style.colorScheme = theme.id
  for (const [key, value] of Object.entries(theme.tokens)) root.style.setProperty(`--${key}`, value)
}
export const useThemeStore = create<{ theme: ThemeName; setTheme: (name: ThemeName) => void }>()(
  (set) => ({
    theme: 'dark',
    setTheme: (theme) => {
      applyTheme(theme)
      set({ theme })
    },
  }),
)
