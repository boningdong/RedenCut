const { app, BrowserWindow } = require('electron')
const { appendFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')

const userData = join(process.env.REDENCUT_HARNESS_RUN_DIRECTORY, 'user-data')
mkdirSync(userData, { recursive: true })
app.setPath('userData', userData)
const record = (stage) =>
  appendFileSync(
    join(process.env.REDENCUT_HARNESS_RUN_DIRECTORY, 'main-startup.jsonl'),
    JSON.stringify({
      at: new Date().toISOString(),
      pid: process.pid,
      stage,
      ready: app.isReady(),
    }) + '\n',
  )
record('entry')
app.on('ready', () => record('ready-event'))
app.on('before-quit', () => record('before-quit'))
process.on('exit', () => record('exit'))

app.whenReady().then(async () => {
  record('when-ready')
  const window = new BrowserWindow({ width: 800, height: 600, show: true })
  record('window-created')
  await window.loadURL(
    'data:text/html,' +
      encodeURIComponent(`<!doctype html><title>Harness probe</title>
        <h1>Harness probe</h1>
        <button onclick="document.querySelector('output').textContent = String(++window.count)">Increment</button>
        <output>0</output><script>window.count = 0; console.log('probe-ready')</script>`),
  )
  record('renderer-loaded')
})
app.on('window-all-closed', () => app.quit())
