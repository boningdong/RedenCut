import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/globals.css'

// Mount the React app into the #root div defined in index.html.
// StrictMode deliberately double-invokes effects in development to help
// surface bugs — you may see useEffect run twice in dev; this is expected.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
