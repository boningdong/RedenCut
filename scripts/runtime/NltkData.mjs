import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import yauzl from 'yauzl'
import { sha256File } from './RuntimeIntegrity.mjs'

const entries = [
  'punkt_tab/README',
  ...['abbrev_types.txt', 'collocations.tab', 'ortho_context.tab', 'sent_starters.txt'].map(
    (name) => `punkt_tab/english/${name}`,
  ),
]

/** Extract only fixed resource paths from a checksum-verified upstream archive. */
export async function stageNltkData(archive, runtimeRoot, source) {
  if ((await sha256File(archive)) !== source.sha256)
    throw new Error('punkt_tab archive checksum mismatch')
  const destination = join(runtimeRoot, 'nltk_data', 'tokenizers')
  await mkdir(join(destination, 'punkt_tab', 'english'), { recursive: true })
  const pending = new Set(entries)
  await new Promise((resolve, reject) => {
    yauzl.open(archive, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error)
      const fail = (failure) => {
        zip.close()
        reject(failure)
      }
      zip.on('error', fail)
      zip.on('end', () =>
        pending.size
          ? reject(new Error(`Missing punkt_tab archive entries: ${[...pending].join(', ')}`))
          : resolve(),
      )
      zip.on('entry', (entry) => {
        if (!entries.includes(entry.fileName)) {
          zip.readEntry()
          return
        }
        if (!pending.delete(entry.fileName)) {
          fail(new Error('Duplicate punkt_tab archive entry'))
          return
        }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) {
            fail(streamError)
            return
          }
          pipeline(stream, createWriteStream(join(destination, entry.fileName))).then(
            () => zip.readEntry(),
            fail,
          )
        })
      })
      zip.readEntry()
    })
  })
}
