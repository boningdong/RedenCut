// ─────────────────────────────────────────────────────────────────────────────
// Theme Store (Zustand)
//
// Holds the active theme name and exposes setTheme() which:
//   1. Injects all theme JSON tokens as inline CSS properties on <html>
//   2. Persists the choice to localStorage
//
// applyTheme() is exported for synchronous use in main.tsx (prevents FOUC).
// ─────────────────────────────────────────────────────────────────────────────

import { create }   from 'zustand'
import darkTheme    from '../themes/dark.json'
import lightTheme   from '../themes/light.json'

export type ThemeName = 'dark' | 'light'

const themes: Record<ThemeName, Record<string, string>> = {
  dark:  darkTheme  as Record<string, string>,
  light: lightTheme as Record<string, string>,
}

export function applyTheme(name: ThemeName): void {
  const root = document.documentElement
  for (const [key, val] of Object.entries(themes[name])) {
    root.style.setProperty(key, val)
  }
}

interface ThemeState {
  theme: ThemeName
  setTheme: (name: ThemeName) => void
}

export const useThemeStore = create<ThemeState>()((set) => ({
  theme: (localStorage.getItem('theme') as ThemeName | null) ?? 'dark',
  setTheme: (name) => {
    applyTheme(name)
    localStorage.setItem('theme', name)
    set({ theme: name })
  },
}))
