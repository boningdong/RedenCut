import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = '/opt/redencut-runtime'
function inventory(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    return statSync(path).isDirectory()
      ? inventory(path)
      : [
          {
            path: relative(root, path),
            sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
          },
        ]
  })
}
writeFileSync(
  join(root, 'manifest.json'),
  JSON.stringify(
    {
      schemaVersion: 1,
      runtimeId: `harness-audio-7.1.5-${process.arch}`,
      platform: 'linux',
      arch: process.arch,
      executables: { ffmpeg: 'bin/ffmpeg', ffprobe: 'bin/ffprobe' },
      components: [
        {
          name: 'libpulse-system-test-dependency',
          version: execFileSync('dpkg-query', ['-W', '-f=${Version}', 'libpulse0'], {
            encoding: 'utf8',
          }),
          license: 'LGPL-2.1-or-later',
          sourceUrl: 'https://sources.debian.org/src/pulseaudio/',
        },
        {
          name: 'ffmpeg',
          version: '7.1.5',
          license: 'LGPL-2.1-or-later',
          sourceUrl: 'https://ffmpeg.org/releases/ffmpeg-7.1.5.tar.xz',
          sourceSha256: 'de668509caf9e35e3cd162473441fdb29538c6d96ed080292b3cf9e6fc5d558f',
        },
        {
          name: 'lame',
          version: '3.100',
          license: 'LGPL-2.0-or-later',
          sourceUrl: 'https://downloads.sourceforge.net/project/lame/lame/3.100/lame-3.100.tar.gz',
          sourceSha256: 'ddfe36cab873794038ae2c1210557ad34857a4b6bdc515785d1da9e175b1da1e',
        },
      ],
      files: inventory(root),
    },
    null,
    2,
  ) + '\n',
)
