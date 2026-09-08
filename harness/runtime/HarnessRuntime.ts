import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { prepareDialog } from '../dialogs/prepareDialog'
import type { HarnessDialogRequest } from '../../src/shared/harnessDialog.types'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import { RunArtifacts } from '../artifacts/RunArtifacts'
import type { ArtifactEntry } from '../artifacts/RunArtifacts'
import { TraceRecorder } from '../artifacts/TraceRecorder'
import { PlaywrightMcpAdapter } from '../ui/PlaywrightMcpAdapter'
import { deadline } from './deadline'
import { assertCloseAllowed } from './closePreconditions'
import { ElectronSession } from './ElectronSession'
import { OperationGate } from './OperationGate'
import { inspectOrphanRuns } from './orphanInspection'
import type {
  ApplicationDiagnostics,
  GenerationIdentity,
  RuntimeOptions,
  RuntimeStatus,
} from './runtime.types'

const execFileAsync = promisify(execFile)

export class HarnessRuntime {
  private current: RuntimeStatus = { state: 'idle', generation: 0, stage: 'idle' }
  private readonly gate = new OperationGate()
  private artifacts: RunArtifacts | undefined
  private session: ElectronSession | undefined
  private adapter: PlaywrightMcpAdapter | undefined
  private trace: TraceRecorder | undefined
  private hasSnapshot = false
  private shuttingDown = false
  private lifecycleOperation: Promise<RuntimeStatus> | undefined
  private readonly hostAbort = new AbortController()
  private readonly startupTimeout: number
  private readonly uiTimeout: number
  private readonly shutdownTimeout: number

  constructor(private readonly options: RuntimeOptions) {
    this.startupTimeout = options.startupTimeoutMs ?? 20_000
    this.uiTimeout = options.uiTimeoutMs ?? 15_000
    this.shutdownTimeout = options.shutdownTimeoutMs ?? 5000
  }

  status(): RuntimeStatus {
    return { ...this.current }
  }

  async start(): Promise<RuntimeStatus> {
    return this.transition(async () => {
      if (this.shuttingDown) throw new Error('HOST_SHUTTING_DOWN')
      if (!['idle', 'stopped'].includes(this.current.state))
        throw new Error('RUN_ALREADY_ACTIVE: use podcut_restart or podcut_stop')
      this.artifacts = new RunArtifacts(this.options.outputRoot, this.options.repositoryRoot)
      this.current = {
        state: 'starting',
        generation: 0,
        stage: 'preflight',
        runId: this.artifacts.runId,
        runDirectory: this.artifacts.directory,
      }
      return this.launchGeneration()
    })
  }

  async restart(options: { rebuild?: boolean; discardUnsaved?: boolean }): Promise<RuntimeStatus> {
    return this.transition(async () => {
      if (this.shuttingDown) throw new Error('HOST_SHUTTING_DOWN')
      if (!this.artifacts) throw new Error('NO_RUN: call podcut_start first')
      await this.checkClosePreconditions(options.discardUnsaved ?? false)
      const recovering = this.current.state === 'failed'
      this.update({ state: 'stopping', stage: 'shutdown' })
      await this.closeGeneration(recovering)
      if (options.rebuild) {
        this.update({ state: 'starting', stage: 'build' })
        try {
          const result = await execFileAsync('npm', ['run', 'build'], {
            cwd: this.options.repositoryRoot,
            timeout: 120_000,
            maxBuffer: 4 * 1024 * 1024,
            signal: this.hostAbort.signal,
          })
          this.artifacts.log(this.current.generation, 'build', result.stdout + result.stderr)
        } catch (error) {
          this.fail(error)
          throw error
        }
      }
      return this.launchGeneration()
    })
  }

  async stop(options: { discardUnsaved?: boolean } = {}): Promise<RuntimeStatus> {
    return this.transition(async () => {
      if (!this.artifacts || this.current.state === 'stopped') return this.status()
      await this.checkClosePreconditions(options.discardUnsaved ?? false)
      const recovering = this.current.state === 'failed'
      this.update({ state: 'stopping', stage: 'shutdown' })
      await this.closeGeneration(recovering)
      this.update({ state: 'stopped', stage: 'stopped', pid: undefined })
      return this.status()
    })
  }

  async listUiTools(): Promise<Tool[]> {
    if (this.adapter) return this.adapter.listTools()
    // Discover schemas without creating a browser or retaining a pre-launch UI session.
    const catalog = await PlaywrightMcpAdapter.create(
      async () => {
        throw new Error('APPLICATION_NOT_READY')
      },
      join(this.options.outputRoot, 'catalog'),
    )
    try {
      return await catalog.listTools()
    } finally {
      await catalog.close()
    }
  }

  async callUiTool(
    name: string,
    args: Record<string, unknown>,
    identity: GenerationIdentity,
    signal?: AbortSignal,
  ): Promise<CallToolResult> {
    this.assertReady(identity)
    return this.gate.runUi(async () => {
      this.assertReady(identity)
      if (signal?.aborted) throw new Error('CALL_CANCELLED')
      if (name !== 'browser_snapshot' && !this.hasSnapshot)
        throw new Error('SNAPSHOT_REQUIRED: capture browser_snapshot for this generation first')
      const controller = new AbortController()
      const cancel = () => controller.abort(signal?.reason)
      signal?.addEventListener('abort', cancel, { once: true })
      this.artifacts!.record(identity.generation, 'tool-start', { name, args })
      try {
        const result = await deadline(
          this.adapter!.callTool(name, args, controller.signal),
          this.uiTimeout,
          'UI_CALL_TIMEOUT',
        )
        if (name === 'browser_snapshot' && !result.isError && !args.target && !args.filename)
          this.hasSnapshot = true
        this.artifacts!.record(identity.generation, 'tool-result', {
          name,
          isError: result.isError ?? false,
          content: result.content.map((item) =>
            item.type === 'image'
              ? {
                  type: item.type,
                  mimeType: item.mimeType,
                  bytes: Math.floor((item.data.length * 3) / 4),
                }
              : item,
          ),
        })
        return { ...result, _meta: { ...result._meta, podcut: identity } }
      } catch (error) {
        controller.abort(error)
        // A cancelled mutation may still complete: quarantine this generation and never replay it.
        this.fail(error)
        throw error
      } finally {
        signal?.removeEventListener('abort', cancel)
      }
    })
  }

  async readDiagnostics(identity: GenerationIdentity): Promise<ApplicationDiagnostics> {
    this.assertReady(identity)
    return this.gate.runUi(async () => {
      this.assertReady(identity)
      const diagnostics = await deadline(
        this.session!.diagnostics(),
        this.uiTimeout,
        'DIAGNOSTICS_TIMEOUT',
      )
      const path = join(
        this.artifacts!.generationDirectory(identity.generation),
        'dialogs/events.jsonl',
      )
      return {
        ...diagnostics,
        dialogs: existsSync(path)
          ? readFileSync(path, 'utf8')
              .trim()
              .split('\n')
              .filter(Boolean)
              .map((line) => JSON.parse(line))
          : [],
      }
    })
  }

  async prepareDialog(
    request: HarnessDialogRequest,
    identity: GenerationIdentity,
  ): Promise<{ prepared: true }> {
    this.assertReady(identity)
    return this.gate.runUi(async () => {
      this.assertReady(identity)
      try {
        prepareDialog(
          this.options.repositoryRoot,
          this.artifacts!.directory,
          identity.generation,
          request,
        )
      } catch (error) {
        this.artifacts!.record(identity.generation, 'dialog-preparation-rejected', {
          request,
          error: String(error),
        })
        throw error
      }
      this.artifacts!.record(identity.generation, 'dialog-prepared', request)
      return { prepared: true }
    })
  }

  listArtifacts(): ArtifactEntry[] {
    return this.artifacts?.list() ?? []
  }

  inspectOrphans() {
    return inspectOrphanRuns(this.options.outputRoot)
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) return
    this.shuttingDown = true
    this.hostAbort.abort()
    try {
      if (this.lifecycleOperation) {
        await deadline(
          this.lifecycleOperation.catch(() => {}),
          this.startupTimeout * 2 + this.shutdownTimeout * 3,
          'HOST_TRANSITION_TIMEOUT',
        )
      }
      await this.stop({ discardUnsaved: true })
    } catch (error) {
      this.recordCleanupEvent('forced-host-shutdown', {
        error: String(error),
        warning: 'Unsettled work or unsaved edits may be lost when the MCP host exits.',
      })
      this.current = { ...this.current, state: 'stopping', stage: 'forced-shutdown' }
      await this.closeGeneration(true)
      try {
        this.update({ state: 'stopped', stage: 'stopped', pid: undefined })
      } catch (artifactError) {
        console.error('Could not persist host shutdown:', String(artifactError))
      }
    }
  }

  private async transition(operation: () => Promise<RuntimeStatus>): Promise<RuntimeStatus> {
    if (this.lifecycleOperation) throw new Error('LIFECYCLE_BUSY')
    this.lifecycleOperation = this.gate.runLifecycle(operation, this.shutdownTimeout)
    try {
      return await this.lifecycleOperation
    } catch (error) {
      if (
        String(error).includes('UI_DRAIN_TIMEOUT') ||
        ['starting', 'stopping'].includes(this.current.state)
      )
        this.fail(error)
      throw error
    } finally {
      this.lifecycleOperation = undefined
    }
  }

  private async launchGeneration(): Promise<RuntimeStatus> {
    const generation = this.current.generation + 1
    this.hasSnapshot = false
    this.update({
      state: 'starting',
      stage: 'preflight',
      generation,
      pid: undefined,
      error: undefined,
    })
    try {
      await access(
        this.options.applicationEntry ?? join(this.options.repositoryRoot, 'out/main/index.js'),
      )
      this.artifacts!.beginGeneration(generation)
      this.update({ stage: 'launch' })
      this.session = await ElectronSession.launch(
        this.options.repositoryRoot,
        this.artifacts!,
        generation,
        this.startupTimeout,
        () => {
          if (
            this.current.generation === generation &&
            ['ready', 'starting'].includes(this.current.state)
          )
            this.fail(new Error('APPLICATION_CRASHED'))
        },
        this.options.applicationEntry,
      )
      this.update({ stage: 'renderer-ready', pid: this.session.child.pid })
      this.assertStartingGeneration(generation)
      this.trace = new TraceRecorder(this.artifacts!, generation)
      await deadline(
        this.trace.start(this.session.application.context()),
        this.startupTimeout,
        'TRACE_START_TIMEOUT',
      )
      this.assertStartingGeneration(generation)
      await this.session.waitUntilReady(this.options.readinessTimeoutMs ?? this.startupTimeout)
      this.assertStartingGeneration(generation)
      this.update({ stage: 'ui-adapter' })
      this.adapter = await this.createUiAdapter(this.session, generation)
      this.assertStartingGeneration(generation)
      this.update({ state: 'ready', stage: 'ready' })
      return this.status()
    } catch (error) {
      this.fail(error)
      await this.closeGeneration()
      throw error
    }
  }

  private async createUiAdapter(
    session: ElectronSession,
    generation: number,
  ): Promise<PlaywrightMcpAdapter> {
    // Capture this generation's context: a late completion must never borrow a replacement session.
    const creating = PlaywrightMcpAdapter.create(
      async () => session.application.context(),
      this.artifacts!.generationDirectory(generation),
    )
    try {
      return await deadline(creating, this.startupTimeout, 'UI_ADAPTER_TIMEOUT')
    } catch (error) {
      void creating
        .then((adapter) => adapter.close())
        .catch((closeError: unknown) => {
          console.error('Late UI adapter cleanup:', String(closeError))
        })
      throw error
    }
  }

  private assertStartingGeneration(generation: number): void {
    if (this.shuttingDown) throw new Error('HOST_SHUTTING_DOWN')
    if (this.current.generation !== generation || this.current.state !== 'starting')
      throw new Error(this.current.error ?? 'STARTUP_INTERRUPTED')
  }

  private async checkClosePreconditions(discardUnsaved: boolean): Promise<void> {
    if (!this.session) return
    if (this.current.state === 'failed' && !discardUnsaved)
      throw new Error(
        'UNSAVED_STATE_UNKNOWN: failed generation requires explicit discardUnsaved before closing',
      )
    let diagnostics: ApplicationDiagnostics
    try {
      diagnostics = await deadline(
        this.session.diagnostics(),
        this.shutdownTimeout,
        'CLOSE_PREFLIGHT_TIMEOUT',
      )
    } catch (error) {
      if (!discardUnsaved)
        throw new Error(
          `UNSAVED_STATE_UNKNOWN: explicit discardUnsaved required; ${String(error)}`,
          { cause: error },
        )
      return
    }
    assertCloseAllowed(diagnostics.renderer, discardUnsaved)
  }

  private async closeGeneration(
    allowAbnormalExit = this.current.state === 'failed',
  ): Promise<void> {
    const trace = this.trace
    const adapter = this.adapter
    const session = this.session
    this.trace = undefined
    this.adapter = undefined
    this.hasSnapshot = false
    try {
      for (const close of [
        () => trace?.stop(this.shutdownTimeout),
        () =>
          deadline(
            adapter?.close() ?? Promise.resolve(),
            this.shutdownTimeout,
            'ADAPTER_CLOSE_TIMEOUT',
          ),
      ]) {
        try {
          await close()
        } catch (error) {
          this.recordCleanupEvent('generation-cleanup-error', { error: String(error) })
        }
      }
    } finally {
      await session?.close(this.shutdownTimeout, allowAbnormalExit)
      if (this.artifacts)
        rmSync(
          join(this.artifacts.generationDirectory(this.current.generation), 'dialogs/pending.json'),
          { force: true },
        )
      if (this.session === session) this.session = undefined
    }
  }

  private recordCleanupEvent(kind: string, data: unknown): void {
    try {
      this.artifacts?.record(this.current.generation, kind, data)
    } catch (error) {
      console.error(`Could not persist ${kind}:`, String(error))
    }
  }

  private assertReady(identity: GenerationIdentity): void {
    if (this.current.state !== 'ready' || this.shuttingDown)
      throw new Error('APPLICATION_NOT_READY: inspect podcut_status and start/restart explicitly')
    if (identity.runId !== this.current.runId || identity.generation !== this.current.generation)
      throw new Error('STALE_GENERATION: use the current run identity and take a fresh snapshot')
  }

  private update(patch: Partial<RuntimeStatus>): void {
    this.current = { ...this.current, ...patch }
    this.artifacts?.update({ status: this.status() })
  }

  private fail(error: unknown): void {
    this.current = { ...this.current, state: 'failed', error: String(error) }
    try {
      this.artifacts?.update({ status: this.status() })
      this.artifacts?.record(this.current.generation, 'failure', {
        stage: this.current.stage,
        error: String(error),
      })
    } catch (artifactError) {
      console.error('Could not persist harness failure:', String(artifactError))
    }
  }
}
