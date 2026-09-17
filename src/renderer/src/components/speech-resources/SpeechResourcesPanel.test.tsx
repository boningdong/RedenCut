// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ModelAccessDialog } from './ModelAccessDialog'
import { SpeechResourcesPanel } from './SpeechResourcesPanel'
import { useResourcesStore } from '../../stores/resources.store'
import { useLocaleStore } from '../../stores/locale.store'
const originalResources = useResourcesStore.getState()
const originalPreferences = useLocaleStore.getState()
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function () {
    this.open = false
  }
  useLocaleStore.setState({
    ...originalPreferences,
    resolvedLocale: 'en',
    textEditingEnabled: true,
    speakerRecognitionEnabled: true,
  })
  useResourcesStore.setState({
    ...originalResources,
    hydrate: vi.fn(async () => {}),
    prepare: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    verify: vi.fn(async () => {}),
    snapshot: {
      revision: 1,
      baseReady: false,
      resources: [
        {
          id: 'whisper',
          capability: 'transcription',
          status: 'missing',
          downloadedBytes: 0,
          totalBytes: null,
        },
        {
          id: 'zh',
          capability: 'alignment',
          status: 'missing',
          downloadedBytes: 0,
          totalBytes: null,
        },
        {
          id: 'en',
          capability: 'alignment',
          status: 'missing',
          downloadedBytes: 0,
          totalBytes: null,
        },
        {
          id: 'speaker',
          capability: 'diarization',
          status: 'missing',
          downloadedBytes: 0,
          totalBytes: null,
        },
      ],
    },
  })
})
afterEach(() => {
  cleanup()
  useResourcesStore.setState(originalResources)
  useLocaleStore.setState(originalPreferences)
})
it('downloads alignment independently and keeps optional authorization locked first', () => {
  render(<SpeechResourcesPanel />)
  expect(screen.queryByRole('button', { name: /Authorize access/ })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Download' }))
  expect(useResourcesStore.getState().prepare).toHaveBeenCalledWith('alignment')
})
it('keeps cancellation in the download action position and offers explicit resume', () => {
  const snapshot = useResourcesStore.getState().snapshot!
  snapshot.resources[0] = {
    ...snapshot.resources[0],
    status: 'downloading',
    downloadedBytes: 30,
    totalBytes: 100,
  }
  render(<SpeechResourcesPanel />)
  expect(screen.queryByRole('progressbar')).toBeNull()
  expect(screen.getByText('30%')).toBeTruthy()
  expect((screen.getByRole('switch', { name: 'Text editing' }) as HTMLInputElement).disabled).toBe(
    true,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(useResourcesStore.getState().cancel).toHaveBeenCalledOnce()
  cleanup()
  snapshot.resources[0].status = 'paused'
  render(<SpeechResourcesPanel />)
  fireEvent.click(screen.getByRole('button', { name: 'Continue download' }))
  expect(useResourcesStore.getState().prepare).toHaveBeenCalledWith({
    kind: 'model',
    modelId: 'whisper',
  })
})
it('submits a token only on explicit verification and does not start a download', async () => {
  const snapshot = useResourcesStore.getState().snapshot!
  snapshot.baseReady = true
  snapshot.resources.forEach((r) => {
    if (r.capability !== 'diarization') r.status = 'ready'
  })
  render(<SpeechResourcesPanel />)
  fireEvent.click(screen.getByRole('button', { name: /Authorize access/ }))
  fireEvent.change(screen.getByLabelText('Hugging Face access token'), {
    target: { value: 'hf_private' },
  })
  expect(useResourcesStore.getState().verify).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Verify access' }))
  await waitFor(() =>
    expect(useResourcesStore.getState().verify).toHaveBeenCalledWith('hf_private'),
  )
  expect((screen.getByLabelText('Hugging Face access token') as HTMLInputElement).value).toBe('')
  expect(useResourcesStore.getState().prepare).not.toHaveBeenCalled()
})

it.each([
  ['runtime-unavailable', 'Unavailable', 'The local speech engine is unavailable.'],
  ['integrity-failed', 'Verification failed', 'The model files could not be verified.'],
  ['download-failed', 'Download failed', 'The download could not finish.'],
  ['access-denied', 'Access denied', 'Model access was denied.'],
])('shows accurate help for %s instead of a generic network error', (error, label, help) => {
  const snapshot = useResourcesStore.getState().snapshot!
  snapshot.resources[0] = { ...snapshot.resources[0], status: 'failed', error }
  render(<SpeechResourcesPanel />)
  expect(screen.getByRole('status', { name: `Transcription model: ${label}` })).toBeTruthy()
  expect(screen.getByRole('alert').textContent).toContain(help)
})

it('shows development instructions, blocks model downloads, and unlocks after validation', async () => {
  const snapshot = useResourcesStore.getState().snapshot!
  const development = {
    platform: 'darwin',
    ffmpeg: true,
    ffprobe: true,
    whisper: true,
    uv: false,
    python: false,
    libraries: false,
    ready: false,
  }
  useResourcesStore.setState({
    snapshot: { ...snapshot, development },
    refresh: vi.fn(async () => {
      useResourcesStore.setState({
        snapshot: {
          ...snapshot,
          development: { ...development, python: true, libraries: true, ready: true },
        },
      })
    }),
  })
  render(<SpeechResourcesPanel />)
  expect((screen.getByRole('button', { name: 'Download' }) as HTMLButtonElement).disabled).toBe(
    true,
  )
  expect(screen.getByText(/Prepare the tools needed by each model above/)).toBeTruthy()
  fireEvent.click(screen.getAllByRole('button', { name: 'Install guide' })[1])
  expect(screen.getByText('npm run setup:speech')).toBeTruthy()
  fireEvent.click(screen.getAllByRole('button', { name: 'Validate' })[1])
  await waitFor(() =>
    expect((screen.getByRole('button', { name: 'Download' }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  )
})
it('omits the development card for snapshots from bundled builds', () => {
  render(<SpeechResourcesPanel />)
  expect(screen.queryByText('Development environment')).toBeNull()
})
it('points runtime failures to development setup instead of app update advice', () => {
  const snapshot = useResourcesStore.getState().snapshot!
  useResourcesStore.setState({
    snapshot: {
      ...snapshot,
      development: {
        platform: 'darwin',
        ffmpeg: true,
        ffprobe: true,
        whisper: true,
        uv: true,
        python: false,
        libraries: false,
        ready: false,
      },
      resources: snapshot.resources.map((r) => ({
        ...r,
        status: 'failed',
        error: 'runtime-unavailable',
      })),
    },
  })
  render(<SpeechResourcesPanel />)
  expect(
    screen.getAllByText(/Complete the Development environment setup above/).length,
  ).toBeGreaterThan(0)
  expect(screen.queryByText(/Reopen the app and check for an app update/)).toBeNull()
})

it('shows checking on the active row while completed rows already show Ready', () => {
  const snapshot = useResourcesStore.getState().snapshot!
  useResourcesStore.setState({
    snapshot: {
      ...snapshot,
      development: {
        platform: 'darwin',
        ffmpeg: true,
        ffprobe: true,
        whisper: true,
        uv: true,
        python: true,
        libraries: false,
        ready: false,
        checking: ['libraries'],
      },
    },
  })
  render(<SpeechResourcesPanel />)
  expect(
    screen.getByRole('status', { name: 'Speech libraries' }).querySelector('.loading-spinner'),
  ).toBeTruthy()
  expect(screen.getByRole('status', { name: 'Python 3.11' }).textContent).toContain('Ready')
  expect(
    screen.getByRole('status', { name: 'Python 3.11' }).querySelector('.loading-spinner'),
  ).toBeNull()
})
it('collapses text-editing details without changing the feature or canceling work', () => {
  render(<SpeechResourcesPanel />)
  fireEvent.click(screen.getByRole('button', { name: 'Text editing' }))
  expect(screen.queryByRole('button', { name: 'Download' })).toBeNull()
  expect((screen.getByRole('switch', { name: 'Text editing' }) as HTMLInputElement).checked).toBe(
    true,
  )
  expect(useResourcesStore.getState().cancel).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Text editing' }))
  expect(screen.getByRole('button', { name: 'Download' })).toBeTruthy()
})
it('detects local credentials in development but only verifies after explicit use', async () => {
  const previous = window.electronAPI
  const detect = vi.fn(async () => ({ status: 'found' as const }))
  window.electronAPI = { ...previous, modelAccessLocal: detect }
  const snapshot = useResourcesStore.getState().snapshot!
  const verifyLocal = vi.fn(async () => {})
  useResourcesStore.setState({
    verifyLocal,
    snapshot: {
      ...snapshot,
      baseReady: true,
      development: {
        platform: 'darwin',
        ffmpeg: true,
        ffprobe: true,
        whisper: true,
        uv: true,
        python: true,
        libraries: true,
        ready: true,
      },
      resources: snapshot.resources.map((r) =>
        r.capability === 'diarization' ? r : { ...r, status: 'ready' },
      ),
    },
  })
  try {
    render(<SpeechResourcesPanel />)
    fireEvent.click(screen.getByRole('button', { name: /Authorize access/ }))
    await waitFor(() => expect(screen.getByText(/Credentials found/)).toBeTruthy())
    expect(verifyLocal).not.toHaveBeenCalled()
    expect((screen.getByLabelText('Hugging Face access token') as HTMLInputElement).value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'Use local login and verify' }))
    expect(verifyLocal).toHaveBeenCalledOnce()
    expect(useResourcesStore.getState().prepare).not.toHaveBeenCalled()
  } finally {
    window.electronAPI = previous
  }
})

it('keeps model downloads in the resource panel after authorization', () => {
  const snapshot = useResourcesStore.getState().snapshot!
  useResourcesStore.setState({
    access: { status: 'granted', hasToken: true },
    snapshot: { ...snapshot, baseReady: true },
  })
  render(<SpeechResourcesPanel />)
  fireEvent.click(screen.getByRole('button', { name: /Authorized/ }))
  expect(useResourcesStore.getState().prepare).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: 'Download speaker model' })).toBeNull()
  expect(screen.getByRole('heading', { name: 'Authorize access' })).toBeTruthy()
})

it.each([true, false])(
  'shows peer credential sections only in development (%s)',
  async (development) => {
    const previous = window.electronAPI
    const detect = vi.fn(async () => ({ status: 'missing' as const }))
    window.electronAPI = { ...previous, modelAccessLocal: detect }
    const snapshot = useResourcesStore.getState().snapshot!
    useResourcesStore.setState({
      snapshot: {
        ...snapshot,
        development: development
          ? {
              platform: 'darwin',
              ffmpeg: true,
              ffprobe: true,
              whisper: true,
              uv: true,
              python: true,
              libraries: true,
              ready: true,
            }
          : undefined,
      },
    })
    try {
      render(<ModelAccessDialog onClose={() => {}} />)
      expect(screen.getByRole('region', { name: 'Enter Hugging Face token' })).toBeTruthy()
      expect(screen.queryByRole('region', { name: 'Local Hugging Face login' }) !== null).toBe(
        development,
      )
      expect(screen.queryByRole('separator') !== null).toBe(development)
      if (development)
        await waitFor(() =>
          expect(screen.getByText('No local login credentials found')).toBeTruthy(),
        )
      else expect(detect).not.toHaveBeenCalled()
    } finally {
      window.electronAPI = previous
    }
  },
)

it('offers Whisper alternatives in a floating menu and downloads only the selected model', async () => {
  const snapshot = useResourcesStore.getState().snapshot!
  snapshot.selectedWhisperModelId = 'whisper'
  snapshot.whisperModels = [
    { id: 'whisper', variant: 'small', recommended: true },
    { id: 'medium', variant: 'medium', recommended: false },
  ]
  snapshot.resources.push({
    id: 'medium',
    capability: 'transcription',
    status: 'ready',
    downloadedBytes: 1,
    totalBytes: 1,
  })
  useResourcesStore.setState({
    selectWhisper: async (id) =>
      useResourcesStore.setState({
        snapshot: { ...snapshot, selectedWhisperModelId: id, revision: 2 },
      }),
  })
  render(<SpeechResourcesPanel />)
  fireEvent.click(screen.getByRole('button', { name: 'Change Whisper model' }))
  const menu = screen.getByRole('menu', { name: 'Whisper model' })
  expect(menu.textContent).toContain('Downloaded')
  expect(menu.textContent).toContain('Not downloaded')
  expect(fireEvent.keyDown(menu, { key: 'Escape' })).toBe(false)
  expect(screen.queryByRole('menu')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Change Whisper model' }))
  fireEvent.click(screen.getByRole('menuitemradio', { name: /Medium/ }))
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  expect(screen.getByRole('status', { name: 'Transcription model: Ready' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Change Whisper model' }))
  fireEvent.click(screen.getByRole('menuitemradio', { name: /Small/ }))
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  fireEvent.click(screen.getByRole('button', { name: 'Download Whisper Small' }))
  expect(useResourcesStore.getState().prepare).toHaveBeenCalledWith({
    kind: 'model',
    modelId: 'whisper',
  })
})

it('allows choosing a model before preparing the development runtime', () => {
  const snapshot = useResourcesStore.getState().snapshot!
  useResourcesStore.setState({
    snapshot: {
      ...snapshot,
      selectedWhisperModelId: 'whisper',
      whisperModels: [{ id: 'whisper', variant: 'small', recommended: true }],
      development: {
        platform: 'darwin',
        ffmpeg: false,
        ffprobe: false,
        whisper: false,
        uv: false,
        python: false,
        libraries: false,
        ready: false,
      },
    },
  })
  render(<SpeechResourcesPanel />)
  expect(
    (screen.getByRole('button', { name: 'Change Whisper model' }) as HTMLButtonElement).disabled,
  ).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Change Whisper model' }))
  expect(screen.getByRole('menuitemradio', { name: /Small/ })).toBeTruthy()
  expect(
    (screen.getByRole('button', { name: 'Download Whisper Small' }) as HTMLButtonElement).disabled,
  ).toBe(true)
})

it('allows Whisper download with its runtime ready while alignment still needs Python', () => {
  const snapshot = useResourcesStore.getState().snapshot!
  useResourcesStore.setState({
    snapshot: {
      ...snapshot,
      selectedWhisperModelId: 'whisper',
      whisperModels: [{ id: 'whisper', variant: 'small', recommended: true }],
      development: {
        platform: 'darwin',
        ffmpeg: true,
        ffprobe: true,
        whisper: true,
        uv: false,
        python: false,
        libraries: false,
        ready: false,
      },
    },
  })
  render(<SpeechResourcesPanel />)
  const download = screen.getByRole('button', {
    name: 'Download Whisper Small',
  }) as HTMLButtonElement
  expect(download.disabled).toBe(false)
  fireEvent.click(download)
  expect(useResourcesStore.getState().prepare).toHaveBeenCalledWith({
    kind: 'model',
    modelId: 'whisper',
  })
  expect((screen.getByRole('button', { name: 'Download' }) as HTMLButtonElement).disabled).toBe(
    true,
  )
})

it.each([true, false])(
  'shows validation progress only for active checks (Python checking: %s)',
  (checking) => {
    const snapshot = useResourcesStore.getState().snapshot!
    const development = {
      platform: 'darwin',
      ffmpeg: true,
      ffprobe: true,
      whisper: true,
      uv: true,
      python: true,
      libraries: false,
      ready: false,
      checking: checking ? ['libraries' as const] : [],
    }
    useResourcesStore.setState({ pending: true, snapshot: { ...snapshot, development } })
    render(<SpeechResourcesPanel />)
    const tools = screen.getByRole('heading', { name: 'Local tools' }).closest('section')!
    const python = screen.getByRole('heading', { name: 'Python runtime' }).closest('section')!
    expect(within(tools).queryByRole('button', { name: 'Validating…' })).toBeNull()
    expect(within(tools).getByRole('button', { name: 'Validate' })).toBeTruthy()
    expect(
      within(python).getByRole('button', { name: checking ? 'Validating…' : 'Validate' }),
    ).toBeTruthy()
  },
)
