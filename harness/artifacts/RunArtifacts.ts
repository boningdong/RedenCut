import { randomUUID } from 'node:crypto'
import {
  appendFileSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { readProcessIdentity } from '../runtime/processIdentity'
import { observeBuildProvenance } from './buildProvenance'

export interface ArtifactEntry {
  path: string
  bytes: number
}

export class RunArtifacts {
  readonly runId = randomUUID()
  readonly directory: string
  private manifest: Record<string, unknown>
  private readonly generations: Record<number, ReturnType<typeof observeBuildProvenance>> = {}

  constructor(
    outputRoot: string,
    private readonly repositoryRoot: string,
  ) {
    this.directory = resolve(outputRoot, this.runId)
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    this.manifest = {
      schemaVersion: 1,
      runId: this.runId,
      createdAt: new Date().toISOString(),
      hostPid: process.pid,
      host: readProcessIdentity(process.pid),
      initialProvenance: observeBuildProvenance(repositoryRoot),
      scope:
        'Gate B empty-state only; native dialogs and product editing workflows are not enabled.',
    }
    this.update({})
  }

  beginGeneration(generation: number): void {
    const provenance = observeBuildProvenance(this.repositoryRoot)
    this.generations[generation] = provenance
    this.update({ generations: this.generations })
    this.record(generation, 'generation-provenance', provenance)
  }

  generationDirectory(generation: number): string {
    const directory = join(this.directory, `generation-${generation}`)
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    return directory
  }

  update(patch: Record<string, unknown>): void {
    this.manifest = { ...this.manifest, ...patch }
    const destination = join(this.directory, 'manifest.json')
    const temporary = `${destination}.tmp`
    writeFileSync(temporary, JSON.stringify(this.manifest, null, 2) + '\n', { mode: 0o600 })
    renameSync(temporary, destination)
  }

  record(generation: number, kind: string, data: unknown): void {
    appendFileSync(
      join(this.generationDirectory(generation), 'events.jsonl'),
      JSON.stringify({ at: new Date().toISOString(), runId: this.runId, generation, kind, data }) +
        '\n',
      { mode: 0o600 },
    )
  }

  log(generation: number, stream: string, message: string): void {
    appendFileSync(join(this.generationDirectory(generation), `${stream}.log`), message, {
      mode: 0o600,
    })
  }

  list(): ArtifactEntry[] {
    const entries: ArtifactEntry[] = []
    const visit = (directory: string) => {
      for (const item of readdirSync(directory, { withFileTypes: true })) {
        if (item.isSymbolicLink()) continue
        const path = join(directory, item.name)
        if (item.isDirectory()) visit(path)
        else if (item.isFile())
          entries.push({ path: relative(this.directory, path), bytes: statSync(path).size })
      }
    }
    entries.push({
      path: 'manifest.json',
      bytes: statSync(join(this.directory, 'manifest.json')).size,
    })
    for (const item of readdirSync(this.directory, { withFileTypes: true })) {
      if (item.isDirectory() && /^generation-\d+$/.test(item.name))
        visit(join(this.directory, item.name))
    }
    return entries
  }
}
