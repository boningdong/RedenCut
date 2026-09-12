import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright'
import { expect, test } from 'vitest'
import { electronEnvironment } from '../runtime/electronEnvironment'

// This test launches real Electron; never fall back to a host desktop session.
test.skipIf(!existsSync('/.dockerenv'))(
  'retains whitelisted rejected IPC codes and localization reasons across the real contextBridge',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'redencut-error-bridge-'))
    const errors = [
      { code: 'operation-failed', reason: 'speech-aligning', message: 'Speech alignment failed.' },
      { code: 'cancelled', reason: 'cancelled', message: 'The operation was cancelled.' },
      {
        code: 'stale-session',
        reason: 'stale-session',
        message: 'This project session is no longer current.',
      },
      { code: 'invalid-request', reason: 'invalid-request', message: 'The request was invalid.' },
    ]
    const main = join(directory, 'main.cjs')
    await writeFile(
      main,
      `
      const { app, BrowserWindow, ipcMain } = require('electron');
      app.setPath('userData', ${JSON.stringify(join(directory, 'user-data'))});
      const errors = ${JSON.stringify(errors)};
      let next = 0;
      ipcMain.handle('project:initialize', () => ({
        ok: false,
        error: { ...errors[next++], cause: '/private/original.wav', internalDiagnostic: '/private/model.bin' }
      }));
      app.whenReady().then(() => {
        const window = new BrowserWindow({
          show: false,
          webPreferences: {
            preload: ${JSON.stringify(resolve('out/preload/index.js'))},
            contextIsolation: true, nodeIntegration: false, sandbox: false
          }
        });
        window.loadURL('data:text/html,<button id="request">Request</button><pre id="result"></pre>');
      });
    `,
    )
    const application = await electron.launch({
      args: [main],
      env: electronEnvironment(process.env),
    })
    try {
      const page = await application.firstWindow()
      await page.evaluate(() => {
        document.querySelector('button')!.addEventListener('click', () => {
          void window.electronAPI.project.initialize().catch((error: unknown) => {
            document.querySelector('pre')!.textContent = JSON.stringify(error)
          })
        })
      })
      for (const error of errors) {
        await page.getByRole('button', { name: 'Request' }).click()
        await expect.poll(() => page.locator('pre').textContent()).toBe(JSON.stringify(error))
      }
    } finally {
      await application.close()
      await rm(directory, { recursive: true, force: true })
    }
  },
)
