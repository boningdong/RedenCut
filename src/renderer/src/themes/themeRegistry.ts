import dark from './dark.json'
import light from './light.json'
export const themeRegistry = [
  { id: 'dark', labelKey: 'settings.dark', tokens: dark },
  { id: 'light', labelKey: 'settings.light', tokens: light },
] as const
export type ThemeName = (typeof themeRegistry)[number]['id']
