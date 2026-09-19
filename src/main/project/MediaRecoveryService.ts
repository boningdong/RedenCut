import { createReadStream, createWriteStream } from 'fs'
import { link, lstat, mkdir, mkdtemp, realpath, rm, stat } from 'fs/promises'
import { dirname, join, relative, sep } from 'path'
import type { AudioSource } from '../../shared/ProjectTypes'
import { copyWithHash } from '../audio/import/copyWithHash'
import { ProjectPathResolver } from './ProjectPathResolver'

import type { MediaRecoveryFailure } from '../../shared/MediaRecoveryTypes'

export class MediaRecoveryError extends Error {
  constructor(
    readonly reason: MediaRecoveryFailure,
    options?: ErrorOptions,
  ) {
    super(`Media recovery failed: ${reason}`, options)
    this.name = 'MediaRecoveryError'
  }
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

function checkCancellation(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('Media recovery aborted', 'AbortError')
}

interface DirectoryIdentity {
  path: string
  device: number
  inode: number
}

// lstat each component: realpath alone misses dangling symlinks at absent destinations.
async function inspectPath(root: string, destination: string): Promise<boolean> {
  const parts = relative(root, destination).split(sep)
  let current = root
  for (const [index, part] of parts.entries()) {
    current = join(current, part)
    let info
    try {
      info = await lstat(current)
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return false
      throw error
    }
    const last = index === parts.length - 1
    if (info.isSymbolicLink() || (last ? !info.isFile() : !info.isDirectory())) {
      throw new MediaRecoveryError('destination-conflict')
    }
  }
  return true
}

async function prepareParents(root: string, destination: string): Promise<DirectoryIdentity[]> {
  const paths = [root]
  let current = root
  for (const part of relative(root, dirname(destination)).split(sep)) {
    current = join(current, part)
    try {
      await mkdir(current)
    } catch (error) {
      if (!hasCode(error, 'EEXIST')) throw error
    }
    const info = await lstat(current)
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new MediaRecoveryError('destination-conflict')
    }
    paths.push(current)
  }
  const identities: DirectoryIdentity[] = []
  for (const path of paths) {
    const info = await lstat(path)
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new MediaRecoveryError('destination-conflict')
    }
    identities.push({ path, device: info.dev, inode: info.ino })
  }
  return identities
}

async function revalidateParents(identities: DirectoryIdentity[]): Promise<void> {
  for (const identity of identities) {
    const info = await lstat(identity.path).catch((cause: unknown) => {
      throw new MediaRecoveryError('destination-conflict', { cause })
    })
    if (!info.isDirectory() || info.dev !== identity.device || info.ino !== identity.inode) {
      throw new MediaRecoveryError('destination-conflict')
    }
  }
}

export class MediaRecoveryService {
  async findMissing(root: string, sources: AudioSource[]): Promise<AudioSource[]> {
    const canonicalRoot = await realpath(root)
    const resolver = new ProjectPathResolver(canonicalRoot)
    const missing: AudioSource[] = []
    for (const source of sources) {
      if (source.location.mode !== 'copy') continue
      const destination = await resolver.resolve(source.location.path)
      if (!(await inspectPath(canonicalRoot, destination))) missing.push(source)
    }
    return missing
  }

  async restore(
    root: string,
    source: AudioSource,
    selectedPath: string,
    signal: AbortSignal,
    onBytes: (bytes: number) => void,
  ): Promise<void> {
    checkCancellation(signal)
    let staging: string | undefined
    let streamFailure: 'read-failed' | 'write-failed' | undefined
    try {
      if (
        source.location.mode !== 'copy' ||
        !source.location.path.startsWith(`media/${source.id}/`)
      ) {
        throw new MediaRecoveryError('destination-conflict')
      }
      const canonicalRoot = await realpath(root)
      const resolver = new ProjectPathResolver(canonicalRoot)
      let destination: string
      try {
        destination = await resolver.resolve(source.location.path)
        if (await inspectPath(canonicalRoot, destination)) {
          throw new MediaRecoveryError('destination-conflict')
        }
      } catch (cause) {
        throw new MediaRecoveryError('destination-conflict', { cause })
      }
      try {
        if (!(await stat(selectedPath)).isFile()) throw new Error('Selection is not a file')
      } catch (cause) {
        throw new MediaRecoveryError('read-failed', { cause })
      }
      const parents = await prepareParents(canonicalRoot, destination)
      // A private directory directly in the canonical bundle avoids shared staging symlinks.
      staging = await mkdtemp(join(canonicalRoot, '.media-recovery-'))
      const stagedFile = join(staging, 'original')
      const fingerprint = await copyWithHash(selectedPath, stagedFile, signal, onBytes, {
        createInput: (path) => {
          const stream = createReadStream(path)
          stream.once('error', () => {
            streamFailure ??= 'read-failed'
          })
          return stream
        },
        createOutput: (path) => {
          const stream = createWriteStream(path, { flags: 'wx' })
          stream.once('error', () => {
            streamFailure ??= 'write-failed'
          })
          return stream
        },
      })
      checkCancellation(signal)
      if (
        fingerprint.sha256 !== source.fingerprint.sha256 ||
        fingerprint.byteLength !== source.fingerprint.byteLength
      ) {
        throw new MediaRecoveryError('content-mismatch')
      }
      await revalidateParents(parents)
      if (
        (await realpath(root)) !== canonicalRoot ||
        (await resolver.resolve(source.location.path)) !== destination
      ) {
        throw new MediaRecoveryError('destination-conflict')
      }
      checkCancellation(signal)
      // link is atomic and fails if any destination entry already exists, including a dangling symlink.
      await link(stagedFile, destination)
    } catch (cause) {
      if (cause instanceof MediaRecoveryError) throw cause
      if (signal.aborted) throw new DOMException('Media recovery aborted', 'AbortError')
      const reason =
        hasCode(cause, 'ENOSPC') || hasCode(cause, 'EDQUOT')
          ? 'insufficient-space'
          : hasCode(cause, 'EEXIST')
            ? 'destination-conflict'
            : (streamFailure ?? 'write-failed')
      throw new MediaRecoveryError(reason, { cause })
    } finally {
      if (staging) await rm(staging, { recursive: true, force: true })
    }
  }
}
