import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { expect, test } from 'vitest'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { HarnessRuntime } from '../harness/runtime/HarnessRuntime'
import { RuntimeToolBackend } from '../harness/mcp/RuntimeToolBackend'
import { createMcpFacade } from '../harness/mcp/createMcpFacade'
import type { ApplicationDiagnostics, RuntimeStatus } from '../harness/runtime/runtime.types'
import { ProjectFileSchema } from '../src/shared/project.types'

test('imported short audio survives project save and a full application restart', async () => {
  const filename = 'mandarin-short-female.wav'
  const fixture = resolve('e2e/fixtures/audio', filename)
  const checksum = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
  const originalHash = checksum(fixture)
  const duration = Number(
    execFileSync(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        fixture,
      ],
      { encoding: 'utf8' },
    ).trim(),
  )
  expect(duration).toBeGreaterThan(0)
  const runtime = new HarnessRuntime({
    repositoryRoot: resolve('.'),
    outputRoot: resolve('.harness-runs'),
    uiTimeoutMs: 30_000,
  })
  const server = createMcpFacade(new RuntimeToolBackend(runtime))
  const client = new Client({ name: 'podcut-project-e2e', version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  let identity: { runId: string; generation: number }
  let runDirectory: string | undefined
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = (await client.callTool({ name, arguments: args }, undefined, {
      timeout: 60_000,
    })) as CallToolResult
    expect(result.isError, JSON.stringify(result.content)).not.toBe(true)
    return result
  }
  const diagnostics = async () =>
    (await call('podcut_read_diagnostics', identity))
      .structuredContent as unknown as ApplicationDiagnostics
  const screenshot = async (label: string) => {
    const result = await call('browser_take_screenshot', { ...identity, type: 'png' })
    const image = result.content.find((item) => item.type === 'image')
    expect(image?.mimeType).toBe('image/png')
    writeFileSync(join(runDirectory!, `${label}.png`), Buffer.from(image!.data, 'base64'))
  }
  const readyTrack = async () => {
    let observed: ApplicationDiagnostics | undefined
    await expect
      .poll(
        async () => {
          observed = await diagnostics()
          expect(observed.dialogs?.filter((event) => event.state === 'rejected')).toEqual([])
          return (
            !observed.renderer.busy &&
            observed.renderer.tracks?.length === 1 &&
            observed.renderer.tracks[0].clips.length === 1 &&
            observed.renderer.tracks[0].clips[0].waveformReady
          )
        },
        { timeout: 40_000, interval: 200 },
      )
      .toBe(true)
    const track = observed!.renderer.tracks![0]
    expect(track.name).toBe('Track 1')
    expect(track.clips[0].sourceStart).toBe(0)
    expect(track.clips[0].sourceEnd).toBeCloseTo(duration, 3)
    return track
  }
  try {
    const started = (await call('podcut_start')).structuredContent as unknown as RuntimeStatus
    identity = { runId: started.runId!, generation: started.generation }
    runDirectory = started.runDirectory!
    console.error(`Project E2E evidence: ${runDirectory}`)
    await call('browser_snapshot', identity)
    await call('podcut_prepare_dialog', {
      ...identity,
      request: { purpose: 'import-audio', selection: { type: 'file', filename } },
    })
    await call('browser_click', { ...identity, target: 'button:text-is("Import Audio")' })
    const importedTrack = await readyTrack()
    await screenshot('imported')
    const selection = { type: 'project', name: 'short-audio.podcut' }
    await call('podcut_prepare_dialog', {
      ...identity,
      request: { purpose: 'save-project', selection },
    })
    await call('browser_click', { ...identity, target: 'button:text-is("Save")' })
    await expect
      .poll(
        async () => {
          const { renderer } = await diagnostics()
          return !renderer.busy && !renderer.dirty && renderer.title.includes('short-audio')
        },
        { timeout: 30_000, interval: 200 },
      )
      .toBe(true)
    const projectRoot = join(runDirectory, 'projects', selection.name)
    const projectPath = join(projectRoot, 'project.json')
    const saved = ProjectFileSchema.parse(JSON.parse(readFileSync(projectPath, 'utf8')))
    expect(saved.tracks).toHaveLength(1)
    expect(saved.tracks[0].id).toBe(importedTrack.id)
    const sources = Object.values(saved.audioSources)
    expect(sources).toHaveLength(1)
    const source = sources[0]
    expect(source.displayName).toBe(filename)
    expect(source.id).toBe(importedTrack.clips[0].audioSourceId)
    expect(source.metadata.durationSeconds).toBeCloseTo(duration, 3)
    expect(source.location.mode).toBe('copy')
    expect(checksum(join(projectRoot, source.location.path))).toBe(originalHash)
    const restarted = (await call('podcut_restart', identity))
      .structuredContent as unknown as RuntimeStatus
    expect(restarted.generation).toBe(started.generation + 1)
    expect(restarted.pid).not.toBe(started.pid)
    identity = { runId: restarted.runId!, generation: restarted.generation }
    expect((await diagnostics()).renderer.tracks).toEqual([])
    await call('browser_snapshot', identity)
    await call('podcut_prepare_dialog', {
      ...identity,
      request: { purpose: 'open-project', selection },
    })
    await call('browser_click', { ...identity, target: 'button:text-is("Open Project")' })
    const reopenedTrack = await readyTrack()
    expect(reopenedTrack).toEqual(importedTrack)
    expect((await diagnostics()).renderer.dirty).toBe(false)
    await screenshot('reopened')
    expect(
      ProjectFileSchema.parse(JSON.parse(readFileSync(projectPath, 'utf8'))).audioSources,
    ).toEqual(saved.audioSources)
    expect(checksum(join(projectRoot, source.location.path))).toBe(originalHash)
    expect(checksum(fixture)).toBe(originalHash)
    await call('podcut_stop', identity)
    for (const generation of [1, 2]) {
      const events = readFileSync(
        join(runDirectory, `generation-${generation}/events.jsonl`),
        'utf8',
      )
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
      expect(
        events.some(
          (event) =>
            event.kind === 'process-exit' && event.data.code === 0 && event.data.signal === null,
        ),
      ).toBe(true)
      expect(events.some((event) => event.kind === 'forced-close')).toBe(false)
    }
  } catch (error) {
    if (runDirectory) writeFileSync(join(runDirectory, 'e2e-failure.txt'), String(error))
    throw error
  } finally {
    await runtime.shutdown()
    await client.close()
    await server.close()
  }
})
