import * as yauzl from 'yauzl'
export async function unzip(path: string): Promise<Record<string, string>> {
  return new Promise((resolve, reject) =>
    yauzl.open(path, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) {
        reject(error)
        return
      }
      const output: Record<string, string> = {}
      zip.on('error', reject)
      zip.on('end', () => resolve(output))
      zip.on('entry', (entry: yauzl.Entry) =>
        zip.openReadStream(entry, (err, stream) => {
          if (err || !stream) {
            reject(err)
            return
          }
          const chunks: Buffer[] = []
          stream.on('data', (c) => chunks.push(c))
          stream.on('error', reject)
          stream.on('end', () => {
            output[entry.fileName] = Buffer.concat(chunks).toString()
            zip.readEntry()
          })
        }),
      )
      zip.readEntry()
    }),
  )
}
