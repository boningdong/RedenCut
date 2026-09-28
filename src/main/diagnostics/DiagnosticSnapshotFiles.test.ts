import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { normalizeSnapshotFile } from './DiagnosticSnapshotFiles'
it('rejects promptly when the validated output cannot be created for an empty input', async () => {
  const root = await mkdtemp(join(tmpdir(), 'snapshot-output-'))
  try {
    await writeFile(join(root, 'runtime.jsonl'), '')
    await mkdir(join(root, 'runtime.jsonl.validated'))
    await expect(normalizeSnapshotFile(root, 'runtime.jsonl', 'runtime')).rejects.toThrow()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 1000)
