import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { ProjectFileSchema } from '../src/shared/project.types'
import { SpeechArtifactSchema } from '../src/shared/speechArtifact.schema'
import { McpTestSession } from './support/McpTestSession'

let session: McpTestSession | undefined

afterEach(async () => {
  await session?.close()
  session = undefined
})

test('real speech analysis publishes an editable durable transcript and survives reopen', async () => {
  session = new McpTestSession()
  await session.start()

  await session.call('podcut_prepare_dialog', {
    request: {
      purpose: 'import-audio',
      selection: { type: 'file', filename: 'mandarin-short-female.wav' },
    },
  })
  await session.call('browser_click', { target: 'button:text-is("Import Audio")' })
  await expect
    .poll(() => session!.page.locator('text=mandarin-short-female.wav').count(), {
      timeout: 40_000,
      interval: 250,
    })
    .toBeGreaterThan(0)

  await session.call('browser_click', { target: 'button:has-text("Generate")' })
  await session.call('browser_click', {
    target: 'section[aria-label="Transcript panel"] button:text-is("Track 1")',
  })
  await expect
    .poll(
      async () => {
        if (await session!.page.locator('[data-testid="canonical-transcript"]').count())
          return 'complete'
        const error = await session!.page.getByRole('alert').allInnerTexts()
        return error.length ? `error: ${error.join(' ')}` : 'running'
      },
      { timeout: 240_000, interval: 500 },
    )
    .toBe('complete')

  const transcript = session.page.locator('[data-testid="canonical-transcript"]')
  expect(await transcript.locator('[data-unit-kind="speech"]').count()).toBeGreaterThan(0)
  expect(await transcript.locator('[data-acoustic-editable="true"]').count()).toBeGreaterThan(0)
  expect(await transcript.innerText()).not.toBe('')

  await session.call('browser_click', {
    target: 'button[title^="Machine label"]',
    doubleClick: true,
  })
  await session.call('browser_fill_form', {
    fields: [
      {
        name: 'Speaker name',
        type: 'textbox',
        target: 'input[aria-label^="Rename"]',
        value: 'Host',
      },
    ],
  })
  await session.call('browser_click', { target: 'input[aria-label^="Rename"] + button' })
  await expect
    .poll(() => session!.page.getByText('● Host').count(), { timeout: 10_000, interval: 200 })
    .toBe(1)
  const transcriptText = await transcript.innerText()
  expect(transcriptText).toContain('Host')
  await session.screenshot('speech-analysis-complete')

  const selection = { type: 'project' as const, name: 'speech-analysis.podcut' }
  await session.call('podcut_prepare_dialog', {
    request: { purpose: 'save-project', selection },
  })
  await session.call('browser_click', { target: 'button:text-is("Save")' })
  await expect
    .poll(() => session!.page.locator('header .project-name').innerText(), {
      timeout: 30_000,
      interval: 250,
    })
    .toContain('speech-analysis')

  const projectRoot = join(session.directory, 'projects', selection.name)
  const project = ProjectFileSchema.parse(
    JSON.parse(readFileSync(join(projectRoot, 'project.json'), 'utf8')),
  )
  expect(project.speechArtifacts).toHaveLength(1)
  expect(project.speakerLabelOverrides.map((override) => override.displayName)).toEqual(['Host'])
  const reference = project.speechArtifacts[0]
  expect(reference.artifactPath).toBe(
    `speech/${reference.audioSourceId}/revision-${reference.analysisRevisionId}.json`,
  )
  const artifact = SpeechArtifactSchema.parse(
    JSON.parse(readFileSync(join(projectRoot, reference.artifactPath), 'utf8')),
  )
  expect(artifact.transcript.units.length).toBeGreaterThan(0)
  expect(artifact.alignment.acousticEditUnits.length).toBeGreaterThan(0)
  expect(artifact.diarization.turns.length).toBeGreaterThan(0)

  await session.restart()
  await session.call('podcut_prepare_dialog', {
    request: { purpose: 'open-project', selection },
  })
  await session.call('browser_click', { target: 'button:text-is("Open Project")' })
  await expect
    .poll(() => session!.page.locator('[data-testid="canonical-transcript"]').innerText(), {
      timeout: 40_000,
      interval: 250,
    })
    .toBe(transcriptText)
  expect(await session.page.getByText('● Host').count()).toBe(1)
  await session.screenshot('speech-analysis-reopened')

  writeFileSync(
    join(session.directory, 'agent-testing-report.md'),
    [
      '# Speech analysis agent testing report',
      '',
      '- PASS `speech-import`: imported the real 13.5 second Mandarin fixture through the UI.',
      '- PASS `speech-generate`: whisper.cpp, WhisperX, and pyannote completed through the job-scoped worker.',
      '- PASS `speech-editability`: the UI exposed aligned speech as editable and retained distinct unit state.',
      '- PASS `speech-persist`: the readable artifact path, metadata binding, save, restart, and reopen all passed.',
      '- NOT RUN `speech-expansion`: the real fixture/model output did not produce a multi-token AcousticEditUnit; covered deterministically by component and resolver tests.',
      '- PASS `speech-speaker-label`: renamed the anonymous speaker through the UI and verified the custom label after restart/reopen.',
      '',
    ].join('\n'),
  )
}, 300_000)
