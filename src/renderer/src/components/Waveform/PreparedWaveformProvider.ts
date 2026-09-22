import type { Track } from '@shared/ProjectTypes'
import type { SessionPrecondition } from '@shared/session.types'
import type { PreparedAudioProgress, PreparedTrackDescriptor } from '@shared/PreparedAudioTypes'
import { useEditorStore } from '../../stores/editor.store'
import type { WaveformDataProvider, WaveformRangeRequest } from './WaveformDataProvider'

/** A display lease is independent of player leases, including during rapid effect toggles. */
export class PreparedWaveformProvider implements WaveformDataProvider {
  private readonly requestId = crypto.randomUUID()
  private descriptor?: PreparedTrackDescriptor
  private peak = 0
  private disposed = false
  constructor(private readonly session: SessionPrecondition) {}

  async prepare(
    tracks: Track[],
    trackId: string,
    onProgress?: (progress: PreparedAudioProgress) => void,
  ): Promise<void> {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      if (stopped || this.disposed || !onProgress || !window.electronAPI.preparedAudio.progress)
        return
      try {
        const progress = await this.currentRevision((session) =>
          window.electronAPI.preparedAudio.progress({ ...session, requestId: this.requestId }),
        )
        if (!stopped && !this.disposed && progress) onProgress(progress)
      } catch {
        /* Preparation reports failures; progress is advisory. */
      }
      if (!stopped && !this.disposed)
        timer = setTimeout(() => {
          void poll()
        }, 250)
    }
    void poll()
    try {
      this.descriptor = await this.currentRevision((session) =>
        window.electronAPI.preparedAudio.prepare({
          ...session,
          requestId: this.requestId,
          tracks,
          trackId,
          mode: 'timeline',
        }),
      )
      if (this.disposed) {
        await this.release()
        throw new DOMException('Waveform preparation cancelled', 'AbortError')
      }
      const result = await this.currentRevision((session) =>
        window.electronAPI.preparedAudio.waveform({
          ...session,
          requestId: this.requestId,
          handle: this.descriptor!.handle,
          startFrame: 0,
          endFrame: this.descriptor!.frameCount,
          targetBuckets: 1,
        }),
      )
      this.peak = result.peak
    } finally {
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }
  async getPeak(): Promise<number> {
    return this.peak
  }
  async readRange(request: WaveformRangeRequest) {
    if (this.disposed || request.signal.aborted)
      throw new DOMException('Waveform cancelled', 'AbortError')
    if (!this.descriptor) throw new Error('Waveform not prepared')
    const startFrame = Math.max(0, Math.floor(request.sourceStartSeconds * 48000))
    const endFrame = Math.min(
      this.descriptor.frameCount,
      Math.ceil(request.sourceEndSeconds * 48000),
    )
    if (endFrame <= startFrame) return { buckets: [] }
    const result = await this.currentRevision((session) =>
      window.electronAPI.preparedAudio.waveform({
        ...session,
        requestId: this.requestId,
        handle: this.descriptor!.handle,
        startFrame,
        endFrame,
        targetBuckets: Math.max(1, Math.min(4096, Math.ceil(request.targetPixelWidth))),
      }),
    )
    if (this.disposed || request.signal.aborted)
      throw new DOMException('Waveform cancelled', 'AbortError')
    return { buckets: result.buckets }
  }
  async dispose(): Promise<void> {
    this.disposed = true
    await this.release()
  }
  private async release() {
    await window.electronAPI.preparedAudio
      .release({ ...this.session, requestId: this.requestId })
      .catch(() => {})
  }
  private async currentRevision<T>(
    action: (session: SessionPrecondition) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const current = useEditorStore.getState().session
      if (this.disposed || current?.workspaceToken !== this.session.workspaceToken)
        throw new DOMException('Project changed', 'AbortError')
      try {
        const result = await action({
          workspaceToken: current.workspaceToken,
          revision: current.revision,
        })
        if (useEditorStore.getState().session?.workspaceToken !== this.session.workspaceToken)
          throw new DOMException('Project changed', 'AbortError')
        return result
      } catch (error) {
        if (attempt >= 2 || useEditorStore.getState().session?.revision === current.revision)
          throw error
      }
    }
  }
}
