import { describe, expect, it } from 'vitest'
import { createEmptyProject, ProjectFileSchema, TrackSchema } from './ProjectTypes'
import {
  getNormalizeEffect,
  NORMALIZE_DEFAULTS,
  normalizationFilter,
  trackGain,
} from './TrackEffects'

const effect = {
  id: 'normalize-1',
  type: 'normalize',
  enabled: true,
  params: { targetLufs: -16, truePeakDbtp: -1.5, loudnessRange: 7 },
}
describe('track effect contracts', () => {
  it.each([2, 3])('migrates version %s to v4 without changing audio defaults', (version) => {
    const project = ProjectFileSchema.parse({
      ...createEmptyProject(),
      version,
      tracks: [{ id: 't', name: 'Voice' }],
    })
    expect(project.version).toBe(4)
    expect(trackGain(project.tracks[0])).toBe(1)
    expect(project.tracks[0].effects).toEqual([])
  })
  it('roundtrips normalization and signed gain with typed parameters', () => {
    const input = {
      ...createEmptyProject(),
      version: 4,
      tracks: [{ id: 't', name: 'Voice', gainDb: 6, effects: [effect] }],
    }
    const project = ProjectFileSchema.parse(input)
    expect(ProjectFileSchema.parse(JSON.parse(JSON.stringify(project)))).toEqual(project)
    expect(getNormalizeEffect(project.tracks[0])?.params).toEqual(NORMALIZE_DEFAULTS)
    expect(trackGain(project.tracks[0])).toBeCloseTo(1.9952623)
    expect(getNormalizeEffect({ effects: [{ ...effect, enabled: false }] })).toBeUndefined()
  })
  it.each([2, 3])('rejects new settings tagged as old version %s', (version) => {
    expect(() =>
      ProjectFileSchema.parse({
        ...createEmptyProject(),
        version,
        tracks: [{ id: 't', name: 'Voice', effects: [effect] }],
      }),
    ).toThrow()
    expect(() =>
      ProjectFileSchema.parse({
        ...createEmptyProject(),
        version,
        tracks: [{ id: 't', name: 'Voice', gainDb: 2 }],
      }),
    ).toThrow()
  })
  it.each([NaN, Infinity, -Infinity, -25, 25])('rejects invalid gain %s', (gainDb) => {
    expect(() => TrackSchema.parse({ id: 't', name: 'Voice', gainDb })).toThrow()
  })
  it('rejects invalid normalization targets and duplicate instances', () => {
    for (const params of [
      { ...effect.params, targetLufs: 0 },
      { ...effect.params, truePeakDbtp: 1 },
      { ...effect.params, loudnessRange: 0 },
    ]) {
      expect(() =>
        TrackSchema.parse({ id: 't', name: 'Voice', effects: [{ ...effect, params }] }),
      ).toThrow()
    }
    expect(() =>
      TrackSchema.parse({ id: 't', name: 'Voice', effects: [effect, { ...effect, id: 'n2' }] }),
    ).toThrow()
  })
  it('preserves legacy effects and builds a bounded shared speech filter', () => {
    const track = TrackSchema.parse({
      id: 't',
      name: 'Voice',
      effects: [{ id: 'eq', type: 'eq', enabled: false, params: { frequency: 120 } }],
    })
    expect(track.effects[0].params).toEqual({ frequency: 120 })
    expect(normalizationFilter(NORMALIZE_DEFAULTS)).toContain('dynaudnorm=')
    expect(normalizationFilter(NORMALIZE_DEFAULTS)).toContain(
      'loudnorm=I=-16:TP=-1.5:LRA=7:linear=false',
    )
    expect(normalizationFilter(NORMALIZE_DEFAULTS)).toMatch(/aresample=48000$/)
  })
})
