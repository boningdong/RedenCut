import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { startLocalizedRenderer } from './i18n/startLocalizedRenderer'
import './styles/globals.css'
import { applyTheme } from './stores/theme.store'
import type { ThemeName } from './stores/theme.store'

// Apply saved theme synchronously before React renders — prevents FOUC in Electron.
const savedTheme = (localStorage.getItem('theme') as ThemeName | null) ?? 'dark'
applyTheme(savedTheme)

startLocalizedRenderer(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
})
