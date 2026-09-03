const { app, BrowserWindow } = require('electron')
const { mkdirSync } = require('node:fs')
const { join } = require('node:path')

const userData = join(process.env.PODCUT_HARNESS_RUN_DIRECTORY, 'user-data')
mkdirSync(userData, { recursive: true })
app.setPath('userData', userData)

app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 800, height: 600, show: true })
  await window.loadURL(
    'data:text/html,' +
      encodeURIComponent(`<!doctype html><title>Harness probe</title>
        <h1>Harness probe</h1>
        <button onclick="document.querySelector('output').textContent = String(++window.count)">Increment</button>
        <output>0</output><script>window.count = 0; console.log('probe-ready')</script>`),
  )
})
app.on('window-all-closed', () => app.quit())
