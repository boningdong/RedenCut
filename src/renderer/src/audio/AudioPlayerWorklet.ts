// ─────────────────────────────────────────────────────────────────────────────
// AudioPlayerWorklet
//
// AudioWorkletProcessor for WebCodecsPlayer.
//
// Design: transferable Float32Array queue — NO SharedArrayBuffer.
//
// Why not SharedArrayBuffer?
//   SAB requires Cross-Origin-Opener-Policy: same-origin +
//   Cross-Origin-Embedder-Policy: require-corp. While Electron sets those
//   for its own renderer, it's easy to break and adds deployment friction.
//   Transferable ArrayBuffers achieve the same zero-copy property without
//   any COOP/COEP setup — ownership is transferred to the worklet thread.
//
// Message protocol  (WebCodecsPlayer → worklet, via AudioWorkletNode.port):
//   { type: 'pcm',   channels: Float32Array[], timestamp: number }
//         — decoded audio chunk (channels array is transferred, not copied)
//   { type: 'flush' }
//         — clear queued audio; fires on seek so stale audio doesn't play
//   { type: 'end' }
//         — end of stream; keep processor alive until queue drains
//
// The worklet maintains an in-worklet queue of chunks and serves them on each
// process() call (every ~2.9 ms at 44100 Hz / 128 samples per block).
// If the queue runs dry (buffer underrun), silence is output.
//
// This file is inlined as a Blob URL by WebCodecsPlayer — it cannot import
// other modules. All logic must be self-contained within WORKLET_CODE.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The string body of the AudioWorkletProcessor.
 * WebCodecsPlayer registers it via:
 *   const blob = new Blob([WORKLET_CODE], { type: 'application/javascript' })
 *   await ctx.audioWorklet.addModule(URL.createObjectURL(blob))
 */
export const WORKLET_CODE = /* javascript */`
class PodCutPlayerProcessor extends AudioWorkletProcessor {
  constructor() {
    super()

    // Queue of decoded PCM chunks waiting to be consumed by process().
    // Each entry: { channels: Float32Array[], offset: number }
    //   channels — one Float32Array per audio channel (planar, not interleaved)
    //   offset   — how many frames of this chunk have already been consumed
    this._queue  = []
    this._ended  = false

    this.port.onmessage = ({ data }) => {
      if (data.type === 'pcm') {
        // Ownership of the Float32Array buffers has been transferred —
        // no copy occurred.
        this._queue.push({ channels: data.channels, offset: 0 })

      } else if (data.type === 'flush') {
        this._queue = []
        this._ended = false

      } else if (data.type === 'end') {
        this._ended = true
      }
    }
  }

  /**
   * Called every ~2.9 ms by the audio thread.
   * Drains the queue into the output buffer, outputting silence if underrun.
   */
  process(_inputs, outputs) {
    const output    = outputs[0]
    const blockSize = output[0]?.length ?? 128
    let   filled    = 0

    while (filled < blockSize && this._queue.length > 0) {
      const chunk     = this._queue[0]
      const remaining = chunk.channels[0].length - chunk.offset
      const toCopy    = Math.min(remaining, blockSize - filled)

      for (let ch = 0; ch < output.length; ch++) {
        // If the source has fewer channels than output, repeat the last channel
        const src = chunk.channels[Math.min(ch, chunk.channels.length - 1)]
        output[ch].set(src.subarray(chunk.offset, chunk.offset + toCopy), filled)
      }

      chunk.offset += toCopy
      filled       += toCopy

      if (chunk.offset >= chunk.channels[0].length) {
        this._queue.shift()   // chunk fully consumed
      }
    }

    // Fill any remaining output with silence (underrun)
    if (filled < blockSize) {
      for (const ch of output) ch.fill(0, filled)
    }

    // Return true to keep the processor alive.
    // Return false only when the stream has ended AND the queue is drained.
    return !this._ended || this._queue.length > 0
  }
}

registerProcessor('podcut-player', PodCutPlayerProcessor)
`

// ── Helper types used by WebCodecsPlayer ─────────────────────────────────────

/** A decoded PCM chunk ready to be sent to the worklet. */
export interface PcmChunk {
  /** One Float32Array per channel (planar). */
  channels:  Float32Array[]
  /** Presentation timestamp in seconds (informational, not used by worklet). */
  timestamp: number
}

/**
 * Send a decoded chunk to the worklet, transferring buffer ownership
 * (zero-copy: the Float32Array memory is moved to the audio thread).
 */
export function sendPcmChunk(port: MessagePort, chunk: PcmChunk): void {
  const transferable = chunk.channels.map((c) => c.buffer)
  port.postMessage(
    { type: 'pcm', channels: chunk.channels, timestamp: chunk.timestamp },
    transferable,
  )
}
