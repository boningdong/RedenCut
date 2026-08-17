import { createHash } from 'crypto'
import { createReadStream, createWriteStream } from 'fs'
import { pipeline } from 'stream/promises'
import { Transform, type Readable, type Writable } from 'stream'

interface CopyWithHashDependencies {
  createInput(path: string): Readable
  createOutput(path: string): Writable
}

export async function copyWithHash(
  source: string,
  destination: string,
  signal: AbortSignal,
  onBytes?: (byteLength: number) => void,
  dependencies: CopyWithHashDependencies = {
    createInput: (path) => createReadStream(path),
    createOutput: (path) => createWriteStream(path, { flags: 'wx' }),
  },
): Promise<{ byteLength: number; sha256: string }> {
  if (signal.aborted) throw abortError()
  const input = dependencies.createInput(source)
  const output = dependencies.createOutput(destination)
  const hash = createHash('sha256')
  let byteLength = 0
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk)
      byteLength += chunk.byteLength
      onBytes?.(byteLength)
      callback(null, chunk)
    },
  })
  const listenerSnapshots = [input, counter, output].map(snapshotListeners)
  try {
    await pipeline(input, counter, output, { signal })
    return { byteLength, sha256: hash.digest('hex') }
  } catch (error) {
    if (signal.aborted && isAbortError(error)) throw abortError()
    throw error
  } finally {
    restoreListeners(input, listenerSnapshots[0])
    restoreListeners(counter, listenerSnapshots[1])
    restoreListeners(output, listenerSnapshots[2])
  }
}

type StreamListener = (...arguments_: never[]) => unknown

function snapshotListeners(stream: NodeJS.EventEmitter): Map<string | symbol, StreamListener[]> {
  return new Map(
    stream.eventNames().map((event) => [event, stream.listeners(event) as StreamListener[]]),
  )
}

function restoreListeners(
  stream: NodeJS.EventEmitter,
  snapshot: Map<string | symbol, StreamListener[]>,
): void {
  for (const event of stream.eventNames()) {
    const retained = new Set(snapshot.get(event) ?? [])
    for (const listener of stream.listeners(event)) {
      if (!retained.has(listener)) stream.removeListener(event, listener)
    }
  }
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  )
}

function abortError(): DOMException {
  return new DOMException('Import aborted', 'AbortError')
}
