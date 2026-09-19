import type { CrossfadeCurve } from './CrossfadeTypes'
export type GainEnvelope =
  | { kind: 'constant' }
  | {
      kind: 'fade'
      direction: 'in' | 'out'
      curve: CrossfadeCurve
      startOutputFrame: number
      frameCount: number
    }
export function gainAtFrame(envelope: GainEnvelope, absoluteOutputFrame: number): number {
  if (envelope.kind === 'constant') return 1
  const u = Math.max(
    0,
    Math.min(
      1,
      (absoluteOutputFrame - envelope.startOutputFrame) / Math.max(1, envelope.frameCount - 1),
    ),
  )
  if (envelope.curve === 'linear') return envelope.direction === 'in' ? u : 1 - u
  return envelope.direction === 'in' ? Math.sin((Math.PI * u) / 2) : Math.cos((Math.PI * u) / 2)
}
