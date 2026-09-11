import type { ChildProcess } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { _electron } from 'playwright'
import type { ElectronApplication, Page } from 'playwright'
import type { RunArtifacts } from '../artifacts/RunArtifacts'
import { deadline } from './deadline'
import { electronEnvironment } from './electronEnvironment'
import { readProcessIdentity } from './processIdentity'
import { quitElectronOnEventLoop } from './quitElectronOnEventLoop'
import type { ApplicationDiagnostics } from './runtime.types'

export class ElectronSession {
  readonly child: ChildProcess
  private page: Page | undefined
  private closing = false
  private forcedTermination = false

  private constructor(
    readonly application: ElectronApplication,
    private readonly artifacts: RunArtifacts,
    private readonly generation: number,
    onCrash: () => void,
  ) {
    this.child = application.process()
    const log = (stream: string, message: string) => {
      try {
        artifacts.log(generation, stream, message)
      } catch (error) {
        console.error('Harness log write failed:', String(error))
      }
    }
    this.child.stdout?.on('data', (data: Buffer) => log('main-stdout', data.toString()))
    this.child.stderr?.on('data', (data: Buffer) => log('main-stderr', data.toString()))
    this.child.once('exit', (code, signal) => {
      try {
        artifacts.record(generation, 'process-exit', { pid: this.child.pid, code, signal })
      } catch (error) {
        console.error('Could not persist Electron exit:', String(error))
      }
    })
    const observed = new WeakSet<Page>()
    const observePage = (page: Page) => {
      if (observed.has(page)) return
      observed.add(page)
      page.on('console', (message) =>
        log('renderer-console', `${message.type()}: ${message.text()}\n`),
      )
      page.on('pageerror', (error) => log('renderer-errors', `${error.stack ?? error.message}\n`))
      page.on('crash', onCrash)
    }
    application.on('window', observePage)
    application.context().pages().forEach(observePage)
    application.on('close', () => {
      if (!this.closing) onCrash()
    })
  }

  static async launch(
    repositoryRoot: string,
    artifacts: RunArtifacts,
    generation: number,
    timeoutMs: number,
    onCrash: () => void,
    applicationEntry = join(repositoryRoot, 'out/main/index.js'),
  ): Promise<ElectronSession> {
    const env = electronEnvironment(process.env)
    env.PODCUT_HARNESS_RUN_DIRECTORY = artifacts.directory
    env.PODCUT_HARNESS_RUN_ID = artifacts.runId
    env.PODCUT_HARNESS_GENERATION = String(generation)
    env.TMPDIR = join(artifacts.directory, 'temporary')
    mkdirSync(env.TMPDIR, { recursive: true })
    // The public default launcher coordinates Electron readiness and applies automation defaults.
    // An executablePath override bypasses that initialization for an unpackaged JS entry.
    const application = await _electron.launch({
      args: [
        applicationEntry,
        `--podcut-harness-run-id=${artifacts.runId}`,
        '--remote-debugging-address=127.0.0.1',
      ],
      cwd: repositoryRoot,
      env,
      timeout: timeoutMs,
    })
    const session = new ElectronSession(application, artifacts, generation, onCrash)
    try {
      artifacts.update({ application: readProcessIdentity(session.child.pid!) })
      return session
    } catch (error) {
      await session.close(timeoutMs)
      throw error
    }
  }

  async waitUntilReady(timeoutMs: number): Promise<void> {
    await deadline(this.observeReadiness(timeoutMs), timeoutMs, 'READINESS_TIMEOUT')
  }

  private async observeReadiness(timeoutMs: number): Promise<void> {
    // Launch returns before the upstream loader's asynchronous readiness release is guaranteed.
    await deadline(
      this.application.evaluate(async ({ app }) => {
        await app.whenReady()
      }),
      timeoutMs,
      'MAIN_READY_TIMEOUT',
    )
    this.artifacts.record(this.generation, 'main-ready', { ready: true })
    this.page = await deadline(this.application.firstWindow(), timeoutMs, 'WINDOW_READY_TIMEOUT')
    await this.page.locator('[data-podcut-session-ready="true"]').waitFor({ timeout: timeoutMs })
    const diagnostics = await this.diagnostics()
    if (!diagnostics.main.hasSingleInstanceLock) throw new Error('SINGLE_INSTANCE_LOCK_NOT_OWNED')
    if (
      diagnostics.main.userData !== join(this.artifacts.directory, 'user-data') ||
      diagnostics.main.temporary !== join(this.artifacts.directory, 'temporary') ||
      diagnostics.main.sessionData !== join(this.artifacts.directory, 'session-data')
    ) {
      throw new Error('APPLICATION_ISOLATION_FAILED')
    }
    this.artifacts.record(this.generation, 'application-ready', diagnostics)
  }

  async diagnostics(): Promise<ApplicationDiagnostics> {
    if (!this.page) throw new Error('RENDERER_NOT_READY')
    const main = await this.application.evaluate(({ app }) => ({
      pid: process.pid,
      userData: app.getPath('userData'),
      sessionData: app.getPath('sessionData'),
      temporary: app.getPath('temp'),
      hasSingleInstanceLock: app.hasSingleInstanceLock(),
    }))
    const renderer = await this.page.locator('[data-podcut-session-ready]').evaluate((element) => ({
      ready: element.getAttribute('data-podcut-session-ready') === 'true',
      dirty: element.getAttribute('data-podcut-dirty') === 'true',
      busy: element.getAttribute('data-podcut-busy') === 'true',
      title: element.querySelector('header .project-name')?.textContent ?? '',
      tracks: Array.from(element.querySelectorAll('[data-lane]')).map((lane) => ({
        id: lane.getAttribute('data-trackid') ?? '',
        name: lane.getAttribute('data-track-name') ?? '',
        clips: Array.from(lane.querySelectorAll('[data-clip-id]')).map((clip) => ({
          id: clip.getAttribute('data-clip-id') ?? '',
          audioSourceId: clip.getAttribute('data-audio-source-id') ?? '',
          sourceStart: Number(clip.getAttribute('data-source-start')),
          sourceEnd: Number(clip.getAttribute('data-source-end')),
          waveformReady: !!clip.querySelector('canvas[data-waveform-ready="true"]'),
        })),
      })),
    }))
    return { main, renderer }
  }

  async close(timeoutMs: number, allowAbnormalExit = false): Promise<void> {
    this.closing = true
    if (this.child.exitCode !== null || this.child.signalCode !== null) {
      this.assertExit(allowAbnormalExit)
      return
    }
    try {
      await quitElectronOnEventLoop(this.application, this.child, timeoutMs)
    } catch (error) {
      try {
        this.artifacts.record(this.generation, 'forced-close', {
          error: String(error),
          pid: this.child.pid,
        })
      } catch (artifactError) {
        console.error('Could not persist forced Electron close:', String(artifactError))
      }
      // Only the still-owned ChildProcess handle is signalled; never search or kill by app name.
      if (this.child.exitCode === null && this.child.signalCode === null)
        this.forcedTermination = this.child.kill('SIGKILL')
    }
    if (this.child.exitCode === null && this.child.signalCode === null) {
      await deadline(
        new Promise<void>((resolve) => this.child.once('exit', () => resolve())),
        timeoutMs,
        'OWNED_PROCESS_DID_NOT_EXIT',
      )
    }
    this.assertExit(allowAbnormalExit)
  }

  private assertExit(allowAbnormalExit: boolean): void {
    // An already reported failed generation may be disposed during explicit recovery.
    if (allowAbnormalExit) return
    if (this.child.signalCode && !(this.forcedTermination && this.child.signalCode === 'SIGKILL'))
      throw new Error(`ELECTRON_ABNORMAL_EXIT: ${this.child.signalCode}`)
    if (this.child.exitCode !== null && this.child.exitCode !== 0)
      throw new Error(`ELECTRON_ABNORMAL_EXIT: ${this.child.exitCode}`)
  }
}
