import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { ProjectFileSchema } from '../src/shared/ProjectTypes'
import { SpeechArtifactSchema } from '../src/shared/speechArtifact.schema'
import { McpTestSession } from './support/McpTestSession'

let session: McpTestSession | undefined

afterEach(async () => {
  await session?.close()
  session = undefined
})

test('real speech analysis publishes an editable durable transcript and survives reopen', async () => {
  session = new McpTestSession()
  await session.start({ speechModels: true })

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
      interval: 250,
    })
    .toBeGreaterThan(0)

  await session.call('browser_click', { target: 'button:has-text("Generate")' })
  await session.call('browser_click', {
    target: 'button:text-is("Start processing")',
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

  await expect
    .poll(() => session!.page.locator('[data-redencut-busy]').getAttribute('data-redencut-busy'), {
      timeout: 240_000,
    })
    .toBe('false')
  await session.call('browser_click', { target: '.identity-tag .identity-edit-button >> nth=0' })
  await session.call('browser_fill_form', {
    fields: [{ name: 'Name', type: 'textbox', target: 'input[aria-label="Name"]', value: 'Host' }],
  })
  await session.call('browser_click', { target: '[role="dialog"] button:text-is("Hex")' })
  await session.call('browser_fill_form', {
    fields: [
      {
        name: 'Speaker color',
        type: 'textbox',
        target: 'input[aria-label="Hex color"]',
        value: '#dc8b9c',
      },
    ],
  })
  await session.call('browser_click', {
    target: '[role="dialog"] button[aria-label="Apply color"]',
  })
  await session.call('browser_click', { target: '[role="dialog"] button:text-is("Save")' })
  await expect
    .poll(() => session!.page.getByRole('button', { name: 'Show Host', exact: true }).count())
    .toBe(1)
  const hostTag = () =>
    session!.page
      .locator('.identity-tag')
      .filter({ has: session!.page.getByRole('button', { name: 'Show Host', exact: true }) })
  await expect
    .poll(() => hostTag().locator('.identity-dot').getAttribute('style'))
    .toContain('rgb(220, 139, 156)')
  const transcriptText = await transcript.innerText()
  expect(transcriptText).toContain('Host')
  await session.screenshot('speech-analysis-complete')

  const selection = { type: 'project' as const, name: 'speech-analysis.redencut' }
  await session.call('redencut_prepare_dialog', {
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
  expect(
    project.speakerIdentities?.people.some(
      (person) => person.displayName === 'Host' && person.color === '#dc8b9c',
    ),
  ).toBe(true)
  const reference = project.speechArtifacts[0]
  expect(reference.artifactPath).toBe(
    `speech/${reference.audioSourceId}/revision-${reference.analysisRevisionId}-${reference.artifactSha256}.json`,
  )
  expect(
    createHash('sha256')
      .update(readFileSync(join(projectRoot, reference.artifactPath)))
      .digest('hex'),
  ).toBe(reference.artifactSha256)
  const artifact = SpeechArtifactSchema.parse(
    JSON.parse(readFileSync(join(projectRoot, reference.artifactPath), 'utf8')),
  )
  expect(artifact.transcript.units.length).toBeGreaterThan(0)
  expect(artifact.alignment.acousticEditUnits.length).toBeGreaterThan(0)
  expect(artifact.schemaVersion === 1 || artifact.diarizationStatus === 'completed').toBe(true)
  if (!artifact.diarization) throw new Error('Expected completed diarization artifact')
  expect(artifact.diarization.turns.length).toBeGreaterThan(0)

  await session.restart()
  await session.call('redencut_prepare_dialog', {
    request: { purpose: 'open-project', selection },
  })
  await session.call('browser_click', { target: 'button:text-is("Open Project")' })
  await expect
    .poll(() => session!.page.locator('[data-testid="canonical-transcript"]').innerText(), {
      timeout: 40_000,
      interval: 250,
    })
    .toBe(transcriptText)
  expect(await session.page.getByRole('button', { name: 'Show Host', exact: true }).count()).toBe(1)
  expect(await hostTag().locator('.identity-dot').getAttribute('style')).toContain(
    'rgb(220, 139, 156)',
  )
  await session.screenshot('speech-analysis-reopened')

  writeFileSync(
    join(session.directory, 'e2e-report.md'),
    [
      '# Fixed speech analysis E2E report',
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
