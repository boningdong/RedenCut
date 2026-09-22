import type { AudioContribution, AudioRenderPlan } from '@shared/audio/AudioRenderPlan'

/** Compile the shared sample-domain plan. Clip and track gain each apply once. */
export function compileFfmpegPlan(
  plan: AudioRenderPlan,
  sourceIndexes: ReadonlyMap<string, number>,
  sourceChannels: ReadonlyMap<string, number> = new Map(),
): string {
  const parts: string[] = []
  const trackLabels: string[] = []
  const stereoMix = plan.tracks.some((track) =>
    track.contributions.some((c) => (sourceChannels.get(c.source.audioSourceId) ?? 1) >= 2),
  )
  let segmentIndex = 0
  for (const track of plan.tracks) {
    const segments: string[] = []
    const stereoTrack = track.contributions.some(
      (contribution) => (sourceChannels.get(contribution.source.audioSourceId) ?? 1) >= 2,
    )
    for (const contribution of track.contributions) {
      const { source, outputStartFrame, gain } = contribution
      const sourceIndex = sourceIndexes.get(source.audioSourceId)
      if (sourceIndex === undefined)
        throw new Error(`Unknown audioSourceId: ${source.audioSourceId}`)
      const label = `seg${segmentIndex++}`
      const envelope = envelopeFilter(contribution)
      // Web Audio duplicates mono into stereo at unity, unlike FFmpeg's default -3 dB upmix.
      const channels =
        stereoTrack && sourceChannels.get(source.audioSourceId) === 1
          ? ',pan=stereo|c0=c0|c1=c0'
          : ''
      parts.push(
        `[${sourceIndex}:a]aresample=48000,atrim=start_sample=${source.sourceStartFrame}:end_sample=${source.sourceStartFrame + source.frameCount},asetpts=PTS-STARTPTS${channels},volume=${gain}${envelope},adelay=${outputStartFrame}S:all=1[${label}]`,
      )
      segments.push(`[${label}]`)
    }
    if (!segments.length) continue
    const label = `track${trackLabels.length}`
    const mix =
      segments.length > 1 ? `amix=inputs=${segments.length}:normalize=0:duration=longest,` : ''
    const gain = track.gainDb ? `volume=${10 ** (track.gainDb / 20)},` : ''
    // This graph renders dry PCM; Auto Level is applied by the shared prepared-track
    // processor before manual gain in playback and before mixing prepared export inputs.
    // Adapt mono to the stereo master at Web Audio's unity duplication gain.
    const masterChannels = stereoMix && !stereoTrack ? 'pan=stereo|c0=c0|c1=c0,' : ''
    parts.push(`${segments.join('')}${mix}${masterChannels}${gain}volume=${track.volume}[${label}]`)
    trackLabels.push(`[${label}]`)
  }
  let output: string
  if (!trackLabels.length) {
    parts.push('anullsrc=r=48000:cl=stereo[silent]')
    output = '[silent]'
  } else if (trackLabels.length === 1) {
    output = trackLabels[0]
  } else {
    parts.push(
      `${trackLabels.join('')}amix=inputs=${trackLabels.length}:normalize=0:duration=longest[mix]`,
    )
    output = '[mix]'
  }
  parts.push(
    `${output}apad=whole_len=${plan.durationFrames},atrim=end_sample=${plan.durationFrames},asetpts=N/SR/TB[export]`,
  )
  return parts.join(';')
}

function envelopeFilter(contribution: AudioContribution): string {
  const { envelope, outputStartFrame } = contribution
  if (envelope.kind === 'constant') return ''
  // n is local to this trimmed contribution; the offset preserves absolute phase.
  const offset = outputStartFrame - envelope.startOutputFrame
  const u = `clip((n+${offset})/${envelope.frameCount - 1},0,1)`
  const amplitude =
    envelope.curve === 'linear'
      ? envelope.direction === 'in'
        ? u
        : `(1-${u})`
      : `${envelope.direction === 'in' ? 'sin' : 'cos'}(PI*${u}/2)`
  return `,aeval=exprs='val(ch)*${amplitude}':channel_layout=same`
}
