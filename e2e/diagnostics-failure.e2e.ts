import { afterEach, expect, test } from 'vitest'
import { McpTestSession } from './support/McpTestSession'

let session: McpTestSession | undefined

afterEach(async () => {
  await session?.close()
  session = undefined
})

test('missing speech setup explains the prerequisite and opens Settings', async () => {
  session = new McpTestSession()
  await session.start()
  await session.call('redencut_prepare_dialog', {
    request: {
      purpose: 'import-audio',
      selection: { type: 'file', filename: 'mandarin-short-female.wav' },
    },
  })
  await session.call('browser_click', { target: 'button:text-is("+ Add Track")' })
  await expect
    .poll(() => session!.page.locator('text=mandarin-short-female.wav').count(), {
      timeout: 40_000,
    })
    .toBeGreaterThan(0)
  await session.call('browser_click', { target: 'button:has-text("Generate")' })
  await session.call('browser_snapshot')
  await session.screenshot('before-speech-start')
  await session.call('browser_click', { target: 'button:text-is("Start processing")' })
  await expect
    .poll(async () => session!.page.getByRole('alert').allInnerTexts(), { timeout: 40_000 })
    .toEqual(expect.arrayContaining([expect.stringMatching(/speech|model|runtime/i)]))
  await session.call('browser_snapshot')
  await session.screenshot('speech-setup-failure')
  await session.call('browser_click', { target: 'button:text-is("Open Settings")' })
  await expect
    .poll(() => session!.page.getByRole('dialog').allInnerTexts())
    .toEqual(expect.arrayContaining([expect.stringMatching(/Models|dependencies/i)]))
  await session.call('browser_snapshot')
  await session.screenshot('speech-setup-settings')
}, 90_000)
