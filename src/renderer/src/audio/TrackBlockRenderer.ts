import type { AudioSourceId } from '@shared/ProjectTypes'
import type { AudioSampleProvider } from '@shared/PlayerTypes'
import type { AudioContribution, TrackRenderPlan } from '@shared/audio/AudioRenderPlan'
import { gainAtFrame } from '@shared/audio/GainEnvelope'

interface ContributionIndex {
  entries: AudioContribution[]
  maximumEnds: number[]
}
const indexes = new WeakMap<TrackRenderPlan, ContributionIndex>()

function contributionIndex(plan: TrackRenderPlan): ContributionIndex {
  const cached = indexes.get(plan)
  if (cached) return cached
  const entries = [...plan.contributions].sort((a, b) => a.outputStartFrame - b.outputStartFrame)
  let end = 0
  const maximumEnds = entries.map(
    (entry) => (end = Math.max(end, entry.outputStartFrame + entry.source.frameCount)),
  )
  const index = { entries, maximumEnds }
  indexes.set(plan, index)
  return index
}

/** Render only intersecting source spans; plans are immutable and indexes are reusable after seeks. */
export async function renderTrackBlock(
  plan: TrackRenderPlan,
  outputStartFrame: number,
  frameCount: number,
  providers: ReadonlyMap<AudioSourceId, AudioSampleProvider>,
  signal: AbortSignal,
): Promise<Float32Array[]> {
  signal.throwIfAborted()
  const { entries, maximumEnds } = contributionIndex(plan)
  let low = 0,
    high = entries.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (maximumEnds[middle] <= outputStartFrame) low = middle + 1
    else high = middle
  }
  const endFrame = outputStartFrame + frameCount
  const output = [new Float32Array(frameCount)]
  for (let i = low; i < entries.length && entries[i].outputStartFrame < endFrame; i++) {
    const entry = entries[i]
    const start = Math.max(outputStartFrame, entry.outputStartFrame)
    const end = Math.min(endFrame, entry.outputStartFrame + entry.source.frameCount)
    if (end <= start) continue
    const provider = providers.get(entry.source.audioSourceId)
    if (!provider) throw new Error(`Missing PCM provider for ${entry.source.audioSourceId}`)
    const count = end - start
    const sourceFrame = entry.source.sourceStartFrame + start - entry.outputStartFrame
    const chunk = await provider.readFrames(sourceFrame, count, signal)
    signal.throwIfAborted()
    if (!Number.isInteger(chunk.frameCount) || chunk.frameCount < 0 || chunk.frameCount > count)
      throw new Error('PCM provider returned an invalid frame count')
    if (
      chunk.channels.length !== provider.channels ||
      chunk.channels.some((channel) => channel.length !== chunk.frameCount)
    )
      throw new Error('PCM provider returned an invalid channel layout')
    // Mono contributions map to every output channel, matching the existing playback channel policy.
    while (output.length < provider.channels) output.push(output[0].slice())
    for (let channel = 0; channel < output.length; channel++) {
      const source = chunk.channels[Math.min(channel, chunk.channels.length - 1)]
      for (let n = 0; n < chunk.frameCount; n++)
        output[channel][start - outputStartFrame + n] +=
          source[n] * entry.gain * gainAtFrame(entry.envelope, start + n)
    }
  }
  return output
}
