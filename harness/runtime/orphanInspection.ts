import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { readProcessIdentity, sameProcess } from './processIdentity'
import type { ProcessIdentity } from './processIdentity'

const processSchema = z.object({
  pid: z.number().int().positive(),
  startedAt: z.string().min(1),
  command: z.string().min(1),
})
const ownershipSchema = z.object({
  runId: z.uuid(),
  host: processSchema,
  application: processSchema,
})

export interface OrphanRun {
  runId: string
  runDirectory: string
  application: ProcessIdentity
  recovery: string
}

export function inspectOrphanRuns(
  root: string,
  readProcess: (pid: number) => ProcessIdentity | null = readProcessIdentity,
): OrphanRun[] {
  if (!existsSync(root)) return []
  const orphans: OrphanRun[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !z.uuid().safeParse(entry.name).success) continue
    const runDirectory = join(root, entry.name)
    try {
      const ownership = ownershipSchema.safeParse(
        JSON.parse(readFileSync(join(runDirectory, 'manifest.json'), 'utf8')),
      )
      if (!ownership.success || ownership.data.runId !== entry.name) continue
      const { runId, host, application } = ownership.data
      if (sameProcess(host, readProcess(host.pid))) continue
      if (!application.command.split(/\s+/).includes(`--redencut-harness-run-id=${runId}`)) continue
      if (!sameProcess(application, readProcess(application.pid))) continue
      orphans.push({
        runId,
        runDirectory,
        application,
        recovery:
          'Manual recovery required; revalidate process identity before terminating. Unsaved state may be lost.',
      })
    } catch {
      // An interrupted or unrelated manifest is not evidence of process ownership.
    }
  }
  return orphans
}
