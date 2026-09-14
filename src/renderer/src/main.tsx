import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { startLocalizedRenderer } from './i18n/startLocalizedRenderer'
import './styles/globals.css'
import { applyTheme } from './stores/theme.store'
applyTheme('dark')

startLocalizedRenderer(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
})
