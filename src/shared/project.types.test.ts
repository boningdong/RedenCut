import { describe, expect, it } from 'vitest'
import { ProjectFileSchema } from './project.types'

describe('ProjectFileSchema', () => {
  it('applies nested export defaults when export settings are omitted', () => {
    const project = ProjectFileSchema.parse({
      version: 1,
      createdAt: '2026-08-11T00:00:00.000Z',
      source: {
        file: 'episode.wav',
        sampleRate: 48_000,
        channels: 2,
        durationSeconds: 60,
      },
    })

    expect(project.export).toEqual({
      targetLUFS: -16,
      truePeakDbTP: -1.5,
      format: 'mp3',
      sampleRate: 48_000,
    })
  })
})
