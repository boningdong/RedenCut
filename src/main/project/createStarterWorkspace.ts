import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ProjectWorkspace } from './ProjectWorkspace'
import { ProjectFileSchema } from '../../shared/ProjectTypes'
import { fingerprintAudioFile } from '../audio/import/audioFingerprint'

/** Original synthesized tones provide a distributable, deterministic editing sample. */
export async function createStarterWorkspace(
  parent: string,
  kind: 'sample' | 'empty',
): Promise<ProjectWorkspace> {
  const workspace = await ProjectWorkspace.initialize(parent)
  if (kind === 'empty') return workspace
  try {
    const rate = 48_000
    const duration = 8
    const pcm = Buffer.alloc(rate * duration * 2)
    for (let index = 0; index < rate * duration; index++) {
      const time = index / rate
      const beat = time % 1
      const envelope = beat < 0.7 ? Math.sin((Math.PI * beat) / 0.7) ** 2 : 0
      pcm.writeInt16LE(
        Math.round(
          Math.sin(2 * Math.PI * (Math.floor(time) % 2 ? 330 : 220) * time) * envelope * 6500,
        ),
        index * 2,
      )
    }
    const header = Buffer.alloc(44)
    header.write('RIFF')
    header.writeUInt32LE(pcm.length + 36, 4)
    header.write('WAVEfmt ', 8)
    header.writeUInt32LE(16, 16)
    header.writeUInt16LE(1, 20)
    header.writeUInt16LE(1, 22)
    header.writeUInt32LE(rate, 24)
    header.writeUInt32LE(rate * 2, 28)
    header.writeUInt16LE(2, 32)
    header.writeUInt16LE(16, 34)
    header.write('data', 36)
    header.writeUInt32LE(pcm.length, 40)
    await mkdir(join(workspace.root, 'media', 'f09c7ac2-443a-4a6a-92b7-4057c0e639bf'), {
      recursive: true,
    })
    const audioPath = join(
      workspace.root,
      'media',
      'f09c7ac2-443a-4a6a-92b7-4057c0e639bf',
      'sample-tones.wav',
    )
    await writeFile(audioPath, Buffer.concat([header, pcm]))
    await workspace.save(
      ProjectFileSchema.parse({
        ...workspace.project,
        audioSources: [
          {
            id: 'f09c7ac2-443a-4a6a-92b7-4057c0e639bf',
            displayName: 'Sample tones',
            location: {
              mode: 'copy',
              path: 'media/f09c7ac2-443a-4a6a-92b7-4057c0e639bf/sample-tones.wav',
            },
            fingerprint: await fingerprintAudioFile(audioPath),
            metadata: {
              durationSeconds: duration,
              sampleRate: rate,
              channels: 1,
              codec: 'pcm_s16le',
              bitrateKbps: 768,
            },
          },
        ],
        tracks: [
          {
            id: 'sample-track',
            name: 'Sample tones',
            color: '#a393ee',
            clips: [
              {
                id: 'sample-clip',
                trackId: 'sample-track',
                audioSourceId: 'f09c7ac2-443a-4a6a-92b7-4057c0e639bf',
                sourceStart: 0,
                sourceEnd: duration,
                outputStart: 0,
              },
            ],
          },
        ],
      }),
    )
    return workspace
  } catch (error) {
    await workspace.close()
    throw error
  }
}
