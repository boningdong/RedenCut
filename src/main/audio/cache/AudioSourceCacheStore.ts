import { readFile, stat } from 'fs/promises'
import { join } from 'path'
import type { AudioSourceCacheDescriptor } from '../../../shared/import.types'
import type { AudioSource, AudioSourceId } from '../../../shared/project.types'
import { ProjectPathResolver } from '../../project/ProjectPathResolver'
import { AudioSourceCacheManifestSchema, type AudioSourceCacheManifest } from './cacheManifest'

export class AudioSourceCacheStore {
  private readonly resolver: ProjectPathResolver

  constructor(private readonly projectRoot: string) {
    this.resolver = new ProjectPathResolver(projectRoot)
  }

  async validate(source: AudioSource): Promise<AudioSourceCacheManifest | null> {
    try {
      const manifestPath = join(this.projectRoot, 'cache', source.id, 'manifest.json')
      const manifest = AudioSourceCacheManifestSchema.parse(
        JSON.parse(await readFile(manifestPath, 'utf8')),
      )
      if (
        manifest.audioSourceId !== source.id ||
        manifest.sourceSha256 !== source.fingerprint.sha256 ||
        manifest.pcm.channels !== source.metadata.channels
      ) {
        return null
      }
      this.assertArtifactScope(source.id, manifest.pcm.file)
      const pcmPath = await this.resolver.resolve(manifest.pcm.file)
      if ((await stat(pcmPath)).size !== manifest.pcm.byteLength) return null
      for (const level of manifest.waveform.levels) {
        this.assertArtifactScope(source.id, level.file)
        const path = await this.resolver.resolve(level.file)
        if ((await stat(path)).size !== level.bucketCount * 8) return null
      }
      return manifest
    } catch {
      return null
    }
  }

  descriptor(manifest: AudioSourceCacheManifest): AudioSourceCacheDescriptor {
    return {
      audioSourceId: manifest.audioSourceId,
      sampleRate: manifest.pcm.sampleRate,
      channels: manifest.pcm.channels,
      frameCount: manifest.pcm.frameCount,
      waveformLevels: manifest.waveform.levels.map(({ samplesPerBucket, bucketCount }) => ({
        samplesPerBucket,
        bucketCount,
      })),
    }
  }

  async resolvePcm(source: AudioSource): Promise<string> {
    const manifest = await this.requireValid(source)
    this.assertArtifactScope(source.id, manifest.pcm.file)
    return this.resolver.resolve(manifest.pcm.file)
  }

  async resolveWaveform(source: AudioSource, samplesPerBucket: number): Promise<string> {
    const manifest = await this.requireValid(source)
    const level = manifest.waveform.levels.find(
      (candidate) => candidate.samplesPerBucket === samplesPerBucket,
    )
    if (!level) throw new Error(`Unknown waveform level ${samplesPerBucket}`)
    this.assertArtifactScope(source.id, level.file)
    return this.resolver.resolve(level.file)
  }

  private async requireValid(source: AudioSource): Promise<AudioSourceCacheManifest> {
    const manifest = await this.validate(source)
    if (!manifest) throw new Error(`Invalid cache for audio source ${source.id}`)
    return manifest
  }

  private assertArtifactScope(id: AudioSourceId, path: string): void {
    if (!path.startsWith(`cache/${id}/`)) {
      throw new Error(`Cache artifact is outside source cache: ${path}`)
    }
  }
}
