import { NORMALIZE_DEFAULTS } from '../TrackEffects'
import { describe, expect, it } from 'vitest'
import type { Track } from '../ProjectTypes'
import { ClipRedactionSchema } from '../ProjectTypes'
import { buildAudioRenderPlan } from './AudioRenderPlanBuilder'
import { DEFAULT_CROSSFADE_SETTINGS } from './CrossfadeTypes'
import { redactionSkipRanges } from '../RedactionTimeline'
import { gainAtFrame } from './GainEnvelope'
import {
  timelineToOutputFrame,
  outputToTimelineFrame,
  outputToTimelinePositions,
} from './TimelineTimeMap'
const fixture = (): Track[] => [
  {
    id: 't',
    name: 't',
    volume: 1,
    muted: false,
    solo: false,
    color: '',
    effects: [],
    clips: [
      {
        id: 'c',
        trackId: 't',
        audioSourceId: 's' as never,
        sourceStart: 0,
        sourceEnd: 2,
        outputStart: 0,
        gain: 1,
        muted: false,
        effects: [],
        redactions: [
          {
            id: 'r',
            sourceStart: 0.8,
            sourceEnd: 1.04,
            crossfade: { ...DEFAULT_CROSSFADE_SETTINGS },
          },
        ],
      },
    ],
  },
]
describe('shared render plan', () => {
  it('validates strict persisted settings without enabling legacy overlays', () => {
    expect(
      ClipRedactionSchema.parse({ id: 'r', sourceStart: 0, sourceEnd: 1 }).crossfade,
    ).toBeUndefined()
    for (const durationMs of [NaN, Infinity, 0, 1001])
      expect(
        ClipRedactionSchema.safeParse({
          id: 'r',
          sourceStart: 0,
          sourceEnd: 1,
          crossfade: { ...DEFAULT_CROSSFADE_SETTINGS, durationMs },
        }).success,
      ).toBe(false)
    expect(
      ClipRedactionSchema.safeParse({
        id: 'r',
        sourceStart: 0,
        sourceEnd: 1,
        crossfade: { ...DEFAULT_CROSSFADE_SETTINGS, curve: 'other' },
      }).success,
    ).toBe(false)
  })
  it('accepts a one-second request and contracts by exactly one second', () => {
    const tracks = fixture()
    const clip = tracks[0].clips[0]
    clip.sourceEnd = 5
    const redact = clip.redactions![0]
    redact.sourceStart = 2
    redact.sourceEnd = 3
    redact.crossfade!.durationMs = 1000
    expect(ClipRedactionSchema.safeParse(redact).success).toBe(true)
    const plan = buildAudioRenderPlan(tracks)
    expect(plan.durationFrames).toBe(3 * 48000)
    expect(plan.resolutions[0]).toMatchObject({
      status: 'active',
      transition: { frameCount: 48000 },
    })
    redact.sourceStart = 0.25
    expect(buildAudioRenderPlan(tracks).resolutions[0]).toMatchObject({
      status: 'active',
      limitedBy: 'short-content',
      transition: { frameCount: 12000 },
    })
  })
  it('contracts equal 1440 frame wings and maps both sources', () => {
    const p = buildAudioRenderPlan(fixture())
    expect(p.durationFrames).toBe(83040)
    const r = p.resolutions[0]
    expect(r.status).toBe('active')
    if (r.status !== 'active') return
    expect(r.transition.left.frameCount).toBe(1440)
    expect(r.transition.right.frameCount).toBe(1440)
    const start = r.transition.outputStartFrame
    expect(timelineToOutputFrame(p.timeMap, 36960 + 100)).toBe(start + 100)
    expect(timelineToOutputFrame(p.timeMap, 49920 + 100)).toBe(start + 100)
    expect(timelineToOutputFrame(p.timeMap, 40000)).toBe(start)
    expect(outputToTimelinePositions(p.timeMap, start + 100)).toEqual([37060, 50020])
    expect(outputToTimelineFrame(p.timeMap, p.durationFrames)).toBe(96000)
    expect(timelineToOutputFrame(p.timeMap, 96000)).toBe(p.durationFrames)
    expect(buildAudioRenderPlan(fixture(), 'timeline').durationFrames).toBe(96000)
  })
  it('disables legacy and grouped disabled overlays', () => {
    const tracks = fixture()
    delete tracks[0].clips[0].redactions![0].crossfade
    expect(buildAudioRenderPlan(tracks).durationFrames).toBe(84480)
    tracks[0].clips[0].redactions!.push({
      id: 'r2',
      sourceStart: 0.9,
      sourceEnd: 1.1,
      crossfade: { ...DEFAULT_CROSSFADE_SETTINGS },
    })
    expect(buildAudioRenderPlan(tracks).resolutions[0]).toMatchObject({
      status: 'inactive',
      reason: 'disabled',
      owner: { redactionIds: ['r', 'r2'] },
    })
  })
  it('protects other retained clips, even when that clip is muted', () => {
    const tracks = fixture()
    tracks[0].clips.push({
      ...tracks[0].clips[0],
      id: 'other',
      outputStart: 0.78,
      sourceStart: 0,
      sourceEnd: 0.01,
      redactions: [],
      muted: true,
    })
    expect(buildAudioRenderPlan(tracks).resolutions[0]).toMatchObject({
      status: 'inactive',
      reason: 'protected-track-content',
    })
    expect(buildAudioRenderPlan(tracks).durationFrames).toBe(84480)
  })
  it('keeps absolute fade phase across seeks and endpoints', () => {
    const envelope = {
      kind: 'fade',
      direction: 'in',
      curve: 'linear',
      startOutputFrame: 100,
      frameCount: 11,
    } as const
    expect(gainAtFrame(envelope, 100)).toBe(0)
    expect(gainAtFrame(envelope, 105)).toBe(0.5)
    expect(gainAtFrame(envelope, 110)).toBe(1)
  })
})

describe('frame and neighboring seam invariants', () => {
  it('allocates shared retained material deterministically without reading it twice', () => {
    const tracks = fixture()
    tracks[0].clips[0].redactions = [
      { id: 'a', sourceStart: 0.5, sourceEnd: 0.6, crossfade: { ...DEFAULT_CROSSFADE_SETTINGS } },
      { id: 'b', sourceStart: 0.64, sourceEnd: 0.74, crossfade: { ...DEFAULT_CROSSFADE_SETTINGS } },
    ]
    const p = buildAudioRenderPlan(tracks),
      active = p.resolutions.filter((r) => r.status === 'active')
    expect(active.map((r) => r.transition.frameCount)).toEqual([1440, 480])
    expect(active[1].limitedBy).toBe('neighbor-transition')
    expect(active[0].transition.right.sourceStartFrame + 1440).toBe(
      active[1].transition.left.sourceStartFrame,
    )
    expect(p.durationFrames).toBe(84480)
    const original = JSON.stringify(tracks)
    buildAudioRenderPlan(tracks)
    expect(JSON.stringify(tracks)).toBe(original)
  })
  it('quantizes boundaries before subtracting duration', () => {
    const tracks = fixture(),
      c = tracks[0].clips[0]
    c.sourceStart = 0.49 / 48000
    c.sourceEnd = 20.51 / 48000
    c.redactions = []
    expect(buildAudioRenderPlan(tracks).tracks[0].contributions[0].source.frameCount).toBe(21)
  })
  it('handles short material and start/end joins', () => {
    const tracks = fixture(),
      c = tracks[0].clips[0]
    c.redactions![0].sourceStart = 1 / 48000
    expect(buildAudioRenderPlan(tracks).resolutions[0]).toMatchObject({
      status: 'inactive',
      reason: 'insufficient-content',
    })
    c.redactions![0].sourceStart = 0
    expect(buildAudioRenderPlan(tracks).resolutions[0]).toMatchObject({
      status: 'inactive',
      reason: 'no-join',
    })
  })
  it('uses half-open endpoints and monotone primary projection', () => {
    const p = buildAudioRenderPlan(fixture()),
      map = p.timeMap
    expect(timelineToOutputFrame(map, 38400)).toBe(36960)
    expect(timelineToOutputFrame(map, 49920)).toBe(36960)
    expect(timelineToOutputFrame(map, 51360)).toBe(38400)
    expect(outputToTimelineFrame(map, 37679)).toBe(37679)
    expect(outputToTimelineFrame(map, 37680)).toBe(50640)
    expect(outputToTimelineFrame(map, 38400)).toBe(51360)
  })
  it('preserves natural gaps and mute/solo eligibility', () => {
    const tracks = fixture()
    tracks[0].clips[0].outputStart = 1
    expect(buildAudioRenderPlan(tracks).durationFrames).toBe(131040)
    tracks[0].muted = true
    expect(buildAudioRenderPlan(tracks).durationFrames).toBe(144000)
    expect(buildAudioRenderPlan(tracks).tracks[0].contributions).toEqual([])
  })
  it('uses shortest grouped request and stable first curve', () => {
    const tracks = fixture()
    tracks[0].clips[0].redactions!.push({
      id: 'later',
      sourceStart: 0.9,
      sourceEnd: 1.05,
      crossfade: { enabled: true, durationMs: 10, curve: 'linear' },
    })
    const r = buildAudioRenderPlan(tracks).resolutions[0]
    expect(r.status).toBe('active')
    if (r.status !== 'active') return
    expect(r.transition.frameCount).toBe(480)
    expect(r.transition.curve).toBe('equal-power')
  })
  it('evaluates equal-power endpoints and energy', () => {
    const e = {
      kind: 'fade',
      direction: 'in',
      curve: 'equal-power',
      startOutputFrame: 500,
      frameCount: 1440,
    } as const
    for (const frame of [500, 501, 1000, 1939])
      expect(
        gainAtFrame(e, frame) ** 2 + gainAtFrame({ ...e, direction: 'out' }, frame) ** 2,
      ).toBeCloseTo(1, 12)
    expect(gainAtFrame(e, 500)).toBe(0)
    expect(gainAtFrame(e, 1939)).toBe(1)
  })
})

describe('reverse mapping input normalization', () => {
  it('rounds before selecting the segment and primary transition wing', () => {
    const { timeMap } = buildAudioRenderPlan(fixture())
    for (const frame of [36959.75, 37679.75, 38399.75]) {
      expect(outputToTimelineFrame(timeMap, frame)).toBe(
        outputToTimelineFrame(timeMap, Math.round(frame)),
      )
    }
  })
  it('clamps negative inputs when the first output segment is a transition', () => {
    const tracks = fixture()
    tracks[0].clips[0].redactions![0].sourceStart = 0.03
    tracks[0].clips[0].redactions![0].sourceEnd = 1
    const { timeMap } = buildAudioRenderPlan(tracks)
    expect(outputToTimelineFrame(timeMap, -1)).toBe(0)
    expect(outputToTimelineFrame(timeMap, -0.75)).toBe(0)
  })
})

describe('Mix source replacement', () => {
  const linked = (): Track[] => {
    const master = fixture()[0]
    master.mixLink = { stemTrackIds: ['b', 'c'] }
    master.clips[0].sourceOverrides = [
      { id: 'o', sourceStart: 0.78, sourceEnd: 1.06, stemTrackIds: ['b', 'c'] },
    ]
    return [
      master,
      ...['b', 'c'].map((id) => ({
        ...master,
        id,
        mixLink: undefined,
        muted: true,
        solo: true,
        volume: 0,
        clips: [
          {
            ...master.clips[0],
            id: id + '-clip',
            trackId: id,
            audioSourceId: id as never,
            sourceOverrides: undefined,
            gain: 0,
            muted: true,
            redactions: [{ id: 'child-redact', sourceStart: 0, sourceEnd: 2 }],
          },
        ],
      })),
    ]
  }
  it('owns Normalize and manual gain on the composed master, ignoring child settings', () => {
    const tracks = linked()
    tracks[0].gainDb = 3
    tracks[0].effects = [
      { id: 'master-normalize', type: 'normalize', enabled: true, params: NORMALIZE_DEFAULTS },
    ]
    tracks[1].gainDb = -24
    tracks[1].effects = [
      {
        id: 'child-normalize',
        type: 'normalize',
        enabled: true,
        params: { ...NORMALIZE_DEFAULTS, targetLufs: -30 },
      },
    ]
    const plan = buildAudioRenderPlan(tracks)
    expect(plan.tracks).toHaveLength(1)
    expect(plan.tracks[0].gainDb).toBe(3)
    expect(plan.tracks[0].normalize).toEqual(NORMALIZE_DEFAULTS)
    expect(new Set(plan.tracks[0].contributions.map((c) => c.source.audioSourceId))).toEqual(
      new Set(['s', 'b', 'c']),
    )
  })
  it('omits linked child output and ignores child solo/redactions for master transitions', () => {
    const plan = buildAudioRenderPlan(linked())
    expect(plan.tracks.map((t) => t.trackId)).toEqual(['t'])
    expect(plan.durationFrames).toBe(83040)
    expect(redactionSkipRanges(linked())).toEqual([{ start: 0.8, end: 1.04 }])
    expect(plan.resolutions[0].status).toBe('active')
    expect(plan.tracks[0].contributions.filter((c) => c.source.audioSourceId === 'b')).toHaveLength(
      2,
    )
  })
  it('preserves envelope phase and master gain across both wing replacements', () => {
    const tracks = linked()
    tracks[0].clips[0].gain = 0.5
    tracks[0].volume = 0.25
    const plan = buildAudioRenderPlan(tracks)
    const pcm = new Float64Array(plan.durationFrames)
    for (const contribution of plan.tracks[0].contributions) {
      const value =
        contribution.source.audioSourceId === 's'
          ? 1
          : contribution.source.audioSourceId === 'b'
            ? 2
            : 3
      for (let i = 0; i < contribution.source.frameCount; i++) {
        const frame = contribution.outputStartFrame + i
        pcm[frame] +=
          value *
          contribution.gain *
          plan.tracks[0].volume *
          gainAtFrame(contribution.envelope, frame)
      }
    }
    for (const offset of [0, 479, 480, 959, 960, 1439]) {
      const incoming = Math.sin(((offset / 1439) * Math.PI) / 2)
      const outgoing = Math.cos(((offset / 1439) * Math.PI) / 2)
      expect(pcm[36960 + offset]).toBeCloseTo(
        0.125 * ((offset < 480 ? 1 : 5) * outgoing + (offset < 960 ? 5 : 1) * incoming),
        10,
      )
    }
  })
  it('rejects gaps and ambiguous overlapping child coverage', () => {
    const tracks = linked()
    tracks[1].clips[0].sourceEnd = 0.79
    expect(() => buildAudioRenderPlan(tracks)).toThrow(/coverage/)
    tracks[1].clips[0].sourceEnd = 2
    tracks[1].clips.push({ ...tracks[1].clips[0], id: 'duplicate' })
    expect(() => buildAudioRenderPlan(tracks)).toThrow(/coverage/)
  })
  it('replaces in timeline mode without contracting redactions', () => {
    const plan = buildAudioRenderPlan(linked(), 'timeline')
    expect(plan.durationFrames).toBe(96000)
    expect(plan.tracks).toHaveLength(1)
    expect(plan.tracks[0].contributions.some((c) => c.source.audioSourceId === 'b')).toBe(true)
  })
})
