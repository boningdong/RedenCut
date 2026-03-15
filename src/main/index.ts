import { app, BrowserWindow, protocol, net } from 'electron'
import { join, extname } from 'path'
import { pathToFileURL } from 'url'

// Register IPC handlers — must be imported before app.whenReady() so
// handlers exist when the renderer first calls window.electronAPI.*
import './ipc/audio.ipc'
import './ipc/project.ipc'
import './ipc/transcript.ipc'

// ─────────────────────────────────────────────────────────────────────────────
// Custom protocol: podcut://
//
// Electron's renderer (Chromium) blocks file:// URLs loaded by <audio>/<video>
// elements for security reasons. We register a custom scheme that proxies
// requests to local files through the privileged main process, which has full
// OS access.
//
// URL mapping:
//   podcut://localhost/<encodeURIComponent(absolutePath)>
//   e.g. podcut://localhost/%2FUsers%2Fboning%2FDownloads%2Ftrack.mp3
//
// protocol.registerSchemesAsPrivileged() MUST be called before app.ready —
// it's a one-time initialisation step that Electron performs at startup.
// ─────────────────────────────────────────────────────────────────────────────
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'podcut',
    privileges: {
      secure: true,           // treated as a secure origin (no mixed-content blocks)
      supportFetchAPI: true,  // allow fetch() against this scheme from the renderer
      stream: true,           // enable byte-range requests (required for audio seeking)
      bypassCSP: true,        // bypass CSP so the <audio> element can load it
    },
  },
])

// ─────────────────────────────────────────────────────────────────────────────
// Window factory
// ─────────────────────────────────────────────────────────────────────────────
function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0f0f0f',       // match --color-bg-primary so no white flash
    titleBarStyle: 'hiddenInset',      // macOS: integrated traffic-light buttons
    // Windows note: titleBarStyle 'hiddenInset' is ignored on Windows.
    // Add `frame: false` + custom drag region for Windows later.
    webPreferences: {
      // Point to the compiled preload script.
      // electron-vite (v5) outputs it to out/preload/index.js.
      preload: join(__dirname, '../preload/index.js'),
      // sandbox: false is required because our preload uses require() at
      // runtime for contextBridge and ipcRenderer (externalized by electron-vite).
      sandbox: false,
    },
  })

  // ── Dev vs prod loading ───────────────────────────────────────────────────
  // In dev, electron-vite starts a Vite dev server and injects
  // ELECTRON_RENDERER_URL. In prod, we load the built HTML file.
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
    win.webContents.openDevTools()     // auto-open DevTools in dev
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// App lifecycle
// ─────────────────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  // ── Register podcut:// handler ──────────────────────────────────────────
  // Translates podcut://localhost/%2FUsers%2F...%2Ftrack.mp3
  // back to a file:// URL and delegates to net.fetch (which runs in the
  // privileged main process and CAN load local files).
  // Map file extension → correct audio MIME type.
  // Without this, net.fetch returns audio files as application/octet-stream
  // which Chromium refuses to decode in an <audio> element.
  const AUDIO_MIME: Record<string, string> = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.flac': 'audio/flac',
    '.aac': 'audio/aac',
    '.m4a': 'audio/mp4',
    '.ogg': 'audio/ogg',
    '.opus': 'audio/ogg',
  }

  protocol.handle('podcut', async (request) => {
    const { pathname } = new URL(request.url)
    // pathname is like /%2FUsers%2Fboning%2FDownloads%2Ftrack.mp3
    // slice(1) removes the leading '/', then we decode to get the real path.
    const filePath = decodeURIComponent(pathname.slice(1))

    // Forward ALL headers from the renderer's request — critically the
    // Range header that <audio> sends for byte-range streaming and seeking.
    const response = await net.fetch(pathToFileURL(filePath).href, {
      headers: Object.fromEntries(request.headers.entries()),
    })

    // Patch Content-Type if net.fetch didn't set an audio/* type.
    const ext = extname(filePath).toLowerCase()
    const mimeType = AUDIO_MIME[ext]
    const existing = response.headers.get('content-type') ?? ''
    if (mimeType && !existing.startsWith('audio/')) {
      const headers = new Headers(response.headers)
      headers.set('content-type', mimeType)
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
    }
    return response
  })

  createWindow()

  // macOS: re-create a window when the dock icon is clicked and no windows exist
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed (except on macOS where the app stays active)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
