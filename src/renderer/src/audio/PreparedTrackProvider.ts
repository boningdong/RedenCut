import type { Track, AudioSourceId } from '@shared/ProjectTypes'
import type { AudioSampleProvider, PlaybackMode } from '@shared/PlayerTypes'
import type { SessionPrecondition } from '@shared/session.types'
import { normalizePublicError } from '../i18n/messages'
import { useEditorStore } from '../stores/editor.store'

/** Owns the session lease; queue generations decide whether completed preparation may attach. */
export class PreparedTrackProvider {
  private requestIds = new Map<string, string>()
  private session: SessionPrecondition | null = null
  private disposed = false

  async prepare(
    tracks: Track[],
    trackId: string,
    mode: PlaybackMode,
  ): Promise<AudioSampleProvider> {
    if (this.disposed) throw new DOMException('Player destroyed', 'AbortError')
    const session = this.currentSession()
    this.session = session
    let requestId = this.requestIds.get(trackId)
    if (!requestId) {
      requestId = crypto.randomUUID()
      this.requestIds.set(trackId, requestId)
    }
    const descriptor = await this.withCurrentRevision((current) => {
      if (this.requestIds.get(trackId) !== requestId)
        throw new DOMException('Track preparation released', 'AbortError')
      return window.electronAPI.preparedAudio.prepare({
        ...current,
        requestId,
        tracks,
        trackId,
        mode,
      })
    })
    if (this.disposed || this.requestIds.get(trackId) !== requestId)
      throw new DOMException('Track preparation released', 'AbortError')
    if (
      !descriptor.handle ||
      !Number.isSafeInteger(descriptor.channels) ||
      descriptor.channels < 1 ||
      descriptor.channels > 32 ||
      !Number.isSafeInteger(descriptor.frameCount) ||
      descriptor.frameCount < 1
    )
      throw new Error('Invalid prepared audio descriptor')
    return {
      audioSourceId: trackId as AudioSourceId,
      format: 'f32-planar',
      sampleRate: 48000,
      channels: descriptor.channels,
      frameCount: descriptor.frameCount,
      readFrames: async (startFrame, frameCount, signal) => {
        signal.throwIfAborted()
        const chunk = await window.electronAPI.preparedAudio
          .read({
            ...this.currentSession(),
            requestId,
            handle: descriptor.handle,
            startFrame,
            frameCount,
          })
          .catch((error: unknown) => {
            throw playbackError(error)
          })
        signal.throwIfAborted()
        if (
          chunk.startFrame !== startFrame ||
          chunk.frameCount !== frameCount ||
          chunk.channels.length !== descriptor.channels ||
          chunk.channels.some(
            (channel) => !(channel instanceof Float32Array) || channel.length !== frameCount,
          )
        )
          throw new Error('Invalid prepared audio samples')
        return chunk
      },
    }
  }

  async retainTracks(trackIds: readonly string[]): Promise<void> {
    const retained = new Set(trackIds)
    const removed = [...this.requestIds].filter(([trackId]) => !retained.has(trackId))
    for (const [trackId] of removed) this.requestIds.delete(trackId)
    if (!this.session) return
    const session = this.session
    await Promise.all(
      removed.map(([, requestId]) =>
        window.electronAPI.preparedAudio.release({ ...session, requestId }),
      ),
    )
  }

  async dispose(): Promise<void> {
    this.disposed = true
    if (this.session)
      await Promise.all(
        [...this.requestIds.values()].map((requestId) =>
          window.electronAPI.preparedAudio.release({ ...this.session!, requestId }),
        ),
      )
    this.requestIds.clear()
  }

  private async withCurrentRevision<T>(
    operation: (session: SessionPrecondition) => Promise<T>,
  ): Promise<T> {
    let session = this.currentSession()
    for (let attempt = 0; ; attempt++) {
      try {
        return await operation(session)
      } catch (error) {
        if (this.disposed) throw new DOMException('Player destroyed', 'AbortError')
        const current = this.currentSession()
        if (current.revision === session.revision || attempt >= 2) throw playbackError(error)
        session = current
      }
    }
  }

  private currentSession(): SessionPrecondition {
    const session = useEditorStore.getState().session
    if (!session || (this.session && session.workspaceToken !== this.session.workspaceToken))
      throw new DOMException('Project changed', 'AbortError')
    return { workspaceToken: session.workspaceToken, revision: session.revision }
  }
}

/** Playback callbacks carry Error instances; retain only the public IPC reason for localization. */
function playbackError(error: unknown): Error {
  if (error instanceof Error) return error
  return Object.assign(new Error('Audio preparation failed'), normalizePublicError(error))
}
