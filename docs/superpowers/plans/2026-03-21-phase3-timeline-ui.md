# Phase 3 — Timeline UI & Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build multi-track waveform UI, clip drag-to-reposition, per-track transcripts, and the FFmpeg export pipeline on top of the existing data model.

**Architecture:** Foundation changes first (data types → store logic → utilities), then UI layer (new components → refactored components), then backend export pipeline. Each task produces a passing typecheck. TDD applied to all pure functions and store logic; skipped for React UI and Electron IPC layers where the test harness can't reach them.

**Tech Stack:** Electron + React + TypeScript, Zustand, WaveSurfer v7, FFmpeg (via child_process), Vitest (node environment, `npm test`), electron-vite (`npm run typecheck`, `npm run build`).

**Spec:** `docs/superpowers/specs/2026-03-21-phase3-timeline-ui-design.md`

---

## File Map

| File | Status | Responsibility |
|------|--------|----------------|
| `src/shared/project.types.ts` | Modify | Add `sourceFileId?: string` to `WordSchema` |
| `src/shared/ipc.types.ts` | Modify | Add `RenderProgress`, `render.export`, `on.renderProgress` |
| `src/renderer/src/stores/transcript.store.ts` | Modify | Add `activeTrackFilter` / `setActiveTrackFilter` |
| `src/renderer/src/stores/timeline.store.ts` | Modify | Add `addSourceFile`; fix `splitAt` output-coordinate bug |
| `src/renderer/src/utils/transcript.ts` | Create | `mergeTrackWords` pure utility |
| `src/renderer/src/utils/transcript.test.ts` | Create | Tests for `mergeTrackWords` |
| `src/renderer/src/stores/timeline.store.test.ts` | Create | Tests for `addSourceFile` and `splitAt` fix |
| `src/renderer/src/components/Waveform/TrackHeader.tsx` | Create | Per-track name/mute/solo/volume/color/remove header |
| `src/renderer/src/components/Waveform/WaveformView.tsx` | Rewrite | Multi-track layout, one WaveSurfer per track, clip drag |
| `src/renderer/src/components/Transcript/TranscriptPanel.tsx` | Modify | Track filter pills; fix delete-to-mute routing |
| `src/renderer/src/components/Export/ExportModal.tsx` | Create | Format/path/LUFS picker + progress bar |
| `src/renderer/src/App.tsx` | Modify | Multi-track `handleGenerateTranscript`; `handleOpenProject` backfill; Export button wiring |
| `src/main/audio/renderer.ts` | Create | Pure FFmpeg filter-graph builder (no binary resolution — testable in isolation) |
| `src/main/audio/renderer.test.ts` | Create | Tests for `buildRenderArgs` |
| `src/main/ipc/render.ipc.ts` | Create | `project:export` IPC handler + progress events |
| `src/preload/index.ts` | Modify | Expose `render.export` and `on.renderProgress` |
| `src/main/index.ts` | Modify | Import `render.ipc.ts` |

---

## Task 1: Add `Word.sourceFileId` to the shared data model

**Files:**
- Modify: `src/shared/project.types.ts:30-47`

- [ ] **Step 1: Add the field to `WordSchema`**

  In `src/shared/project.types.ts`, add one line after the `muted` field:

  ```typescript
  // After: muted: z.boolean().default(false),
  /**
   * ID of the SourceFile this word came from.
   * undefined on legacy words — backfilled to sourceFiles[0].id on project open.
   */
  sourceFileId: z.string().optional(),
  ```

- [ ] **Step 2: Typecheck**

  ```bash
  npm run typecheck
  ```
  Expected: 0 errors. The `Word` type now has `sourceFileId?: string`.

- [ ] **Step 3: Commit**

  ```bash
  git add src/shared/project.types.ts
  git commit -m "feat(types): add Word.sourceFileId for multi-track transcript association"
  ```

---

## Task 2: Extend IPC contract — render namespace + RenderProgress

**Files:**
- Modify: `src/shared/ipc.types.ts:1-99`

- [ ] **Step 1: Add `RenderProgress` type and `render` namespace**

  In `src/shared/ipc.types.ts`, add after the `transcript` block (before the `on` block):

  ```typescript
  /** Progress snapshot emitted during an export render. */
  export interface RenderProgress {
    /** 0–1 */
    percent: number
    /** Seconds of output rendered so far */
    currentSeconds: number
    /** Total output duration in seconds */
    totalSeconds: number
  }
  ```

  Add to `IElectronAPI`, after the `transcript` block:

  ```typescript
  render: {
    /**
     * Runs the FFmpeg export pipeline for the given project.
     * Emits render:progress events via on.renderProgress.
     */
    export(project: ProjectFile, outputPath: string): Promise<void>
  }
  ```

  Add to the `on` block, after `transcriptProgress`:

  ```typescript
  /** Fired during export with current render progress. */
  renderProgress(callback: (p: RenderProgress) => void): () => void
  ```

  Add `RenderProgress` to the import at the top (it is already exported; no change needed there since it's defined in the same file).

- [ ] **Step 2: Typecheck**

  ```bash
  npm run typecheck
  ```
  Expected: error in `src/preload/index.ts` — "Property 'render' is missing in type..." and "Property 'renderProgress' is missing...". This is the `satisfies IElectronAPI` guard catching the gap — correct. The preload will be fixed in Task 12.

- [ ] **Step 3: Commit**

  ```bash
  git add src/shared/ipc.types.ts
  git commit -m "feat(ipc): add render.export and on.renderProgress to IElectronAPI contract"
  ```

---

## Task 3: Add `activeTrackFilter` to transcript.store

**Files:**
- Modify: `src/renderer/src/stores/transcript.store.ts`

- [ ] **Step 1: Add field and action to the interface**

  In the `TranscriptState` interface, add after `showMutedWords`:

  ```typescript
  /**
   * When non-null, only words from this sourceFileId are shown.
   * null = all tracks merged.
   */
  activeTrackFilter: string | null
  setActiveTrackFilter: (sourceFileId: string | null) => void
  ```

- [ ] **Step 2: Add to initialState and implementation**

  In `initialState`, add:
  ```typescript
  activeTrackFilter: null as string | null,
  ```

  In the store implementation, add:
  ```typescript
  setActiveTrackFilter: (sourceFileId) => set({ activeTrackFilter: sourceFileId }),
  ```

  Also add `activeTrackFilter` to the `reset` payload (it is spread from `initialState`, so this is automatic if `initialState` is updated).

- [ ] **Step 3: Typecheck**

  ```bash
  npm run typecheck
  ```
  Expected: 0 errors.

- [ ] **Step 4: Commit**

  ```bash
  git add src/renderer/src/stores/transcript.store.ts
  git commit -m "feat(store): add activeTrackFilter to transcript.store for per-track filtering"
  ```

---

## Task 4: `mergeTrackWords` utility — TDD

**Files:**
- Create: `src/renderer/src/utils/transcript.ts`
- Create: `src/renderer/src/utils/transcript.test.ts`

- [ ] **Step 1: Write the failing tests**

  Create `src/renderer/src/utils/transcript.test.ts`:

  ```typescript
  import { describe, it, expect } from 'vitest'
  import { mergeTrackWords } from './transcript'
  import type { Word } from '@shared/project.types'

  // Minimal word factory
  const w = (id: string, start: number, sourceFileId?: string): Word => ({
    id,
    text: id,
    start,
    end: start + 1,
    muted: false,
    sourceFileId,
  })

  describe('mergeTrackWords', () => {
    it('replaces existing words for the given sourceFileId', () => {
      const existing = [w('a', 0, 'sf1'), w('b', 2, 'sf2')]
      const incoming = [w('c', 1, 'sf1')]
      const result = mergeTrackWords(existing, incoming, 'sf1')
      // sf1 words replaced by incoming; sf2 word kept; sorted by start
      expect(result.map((x) => x.id)).toEqual(['c', 'b'])
    })

    it('sorts the result by start time', () => {
      const existing = [w('a', 5, 'sf1'), w('b', 1, 'sf2')]
      const incoming = [w('c', 3, 'sf1')]
      const result = mergeTrackWords(existing, incoming, 'sf1')
      expect(result.map((x) => x.start)).toEqual([1, 3])
    })

    it('preserves words with undefined sourceFileId (legacy)', () => {
      const existing = [w('legacy', 0, undefined)]
      const incoming = [w('new', 1, 'sf1')]
      const result = mergeTrackWords(existing, incoming, 'sf1')
      expect(result.some((x) => x.id === 'legacy')).toBe(true)
    })

    it('handles empty existing array', () => {
      const result = mergeTrackWords([], [w('a', 0, 'sf1')], 'sf1')
      expect(result).toHaveLength(1)
    })

    it('handles empty incoming array (clears the track)', () => {
      const existing = [w('a', 0, 'sf1'), w('b', 1, 'sf2')]
      const result = mergeTrackWords(existing, [], 'sf1')
      expect(result.map((x) => x.id)).toEqual(['b'])
    })

    it('does not affect words from a different sourceFileId', () => {
      const existing = [w('x', 0, 'sf1'), w('y', 1, 'sf2'), w('z', 2, 'sf1')]
      const incoming = [w('new', 0.5, 'sf1')]
      const result = mergeTrackWords(existing, incoming, 'sf1')
      expect(result.some((r) => r.id === 'y')).toBe(true)
      expect(result.filter((r) => r.sourceFileId === 'sf1').map((r) => r.id)).toEqual(['new'])
    })

    it('is idempotent when called twice with the same incoming', () => {
      const existing = [w('a', 0, 'sf1')]
      const incoming = [w('b', 0, 'sf1')]
      const once  = mergeTrackWords(existing, incoming, 'sf1')
      const twice = mergeTrackWords(once, incoming, 'sf1')
      expect(twice.map((x) => x.id)).toEqual(['b'])
    })
  })
  ```

- [ ] **Step 2: Run tests — verify they fail**

  ```bash
  npm test -- src/renderer/src/utils/transcript.test.ts
  ```
  Expected: FAIL — `mergeTrackWords` not found.

- [ ] **Step 3: Implement `mergeTrackWords`**

  Create `src/renderer/src/utils/transcript.ts`:

  ```typescript
  import type { Word } from '@shared/project.types'

  /**
   * Merges a new set of words for a specific source file into the existing flat
   * word array. All existing words for `sourceFileId` are replaced by `incoming`.
   * Words with `sourceFileId === undefined` are never removed (legacy compatibility).
   * Result is sorted by `word.start`.
   *
   * Precondition: all existing words that should be kept already have `sourceFileId` set.
   */
  export function mergeTrackWords(
    existing: Word[],
    incoming: Word[],
    sourceFileId: string,
  ): Word[] {
    return [
      ...existing.filter((w) => w.sourceFileId !== sourceFileId),
      ...incoming,
    ].sort((a, b) => a.start - b.start)
  }
  ```

- [ ] **Step 4: Run tests — verify they pass**

  ```bash
  npm test -- src/renderer/src/utils/transcript.test.ts
  ```
  Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/renderer/src/utils/transcript.ts src/renderer/src/utils/transcript.test.ts
  git commit -m "feat(utils): add mergeTrackWords for per-track transcript merge"
  ```

---

## Task 5: Fix `splitAt` + add `addSourceFile` to timeline.store — TDD

**Files:**
- Modify: `src/renderer/src/stores/timeline.store.ts`
- Create: `src/renderer/src/stores/timeline.store.test.ts`

### 5a — Write failing tests

- [ ] **Step 1: Create the test file**

  Create `src/renderer/src/stores/timeline.store.test.ts`:

  ```typescript
  import { describe, it, expect, beforeEach } from 'vitest'
  import { useTimelineStore } from './timeline.store'

  beforeEach(() => {
    useTimelineStore.getState().reset()
  })

  // ── addSourceFile ────────────────────────────────────────────────────────

  describe('addSourceFile', () => {
    it('creates a new SourceFile and returns its id', () => {
      const id = useTimelineStore.getState().addSourceFile('/tmp/a.mp3', 10)
      expect(id).toBe('/tmp/a.mp3')
      const { sourceFiles } = useTimelineStore.getState()
      expect(sourceFiles).toHaveLength(1)
      expect(sourceFiles[0]).toMatchObject({ id: '/tmp/a.mp3', filePath: '/tmp/a.mp3', duration: 10 })
    })

    it('is idempotent — calling twice with the same path does not duplicate', () => {
      useTimelineStore.getState().addSourceFile('/tmp/a.mp3', 10)
      const id2 = useTimelineStore.getState().addSourceFile('/tmp/a.mp3', 10)
      expect(id2).toBe('/tmp/a.mp3')
      expect(useTimelineStore.getState().sourceFiles).toHaveLength(1)
    })

    it('does not push to undoStack', () => {
      useTimelineStore.getState().addSourceFile('/tmp/a.mp3', 10)
      expect(useTimelineStore.getState().undoStack).toHaveLength(0)
    })
  })

  // ── splitAt — output coordinate correctness ──────────────────────────────

  describe('splitAt — after moveClip', () => {
    it('finds clip using output coordinates, not source coordinates', () => {
      // Set up a single clip at outputStart=10, sourceStart=0, sourceEnd=5
      useTimelineStore.getState().initFromFile('/tmp/a.mp3', 20)
      const { tracks } = useTimelineStore.getState()
      const track = tracks[0]
      const clip = track.clips[0]
      // Manually move the clip to outputStart=10 by calling moveClip
      useTimelineStore.getState().moveClip(clip.id, 10)

      // Now splitAt time=12 (inside the clip at output coords 10–20)
      useTimelineStore.getState().splitAt(12)

      const { tracks: newTracks } = useTimelineStore.getState()
      const clips = newTracks[0].clips
      expect(clips).toHaveLength(2)
    })

    it('left clip sourceEnd is mapped back to source coordinates', () => {
      useTimelineStore.getState().initFromFile('/tmp/a.mp3', 20)
      const { tracks } = useTimelineStore.getState()
      const clip = tracks[0].clips[0]
      useTimelineStore.getState().moveClip(clip.id, 10)

      // splitAt output time=12 → offset from outputStart=10 is 2s
      // left.sourceEnd should be sourceStart(0) + 2 = 2
      useTimelineStore.getState().splitAt(12)

      const leftClip = useTimelineStore.getState().tracks[0].clips[0]
      expect(leftClip.sourceEnd).toBeCloseTo(2)
      expect(leftClip.outputStart).toBeCloseTo(10)
    })

    it('right clip sourceStart and outputStart are updated correctly', () => {
      useTimelineStore.getState().initFromFile('/tmp/a.mp3', 20)
      const { tracks } = useTimelineStore.getState()
      const clip = tracks[0].clips[0]
      useTimelineStore.getState().moveClip(clip.id, 10)

      useTimelineStore.getState().splitAt(12)

      const clips = useTimelineStore.getState().tracks[0].clips
      const rightClip = clips[1]
      expect(rightClip.sourceStart).toBeCloseTo(2)   // sourceStart + offset
      expect(rightClip.outputStart).toBeCloseTo(12)  // = time
    })

    it('is a no-op when time is at exactly the clip boundary (not strictly inside)', () => {
      useTimelineStore.getState().initFromFile('/tmp/a.mp3', 20)
      const { tracks } = useTimelineStore.getState()
      const clip = tracks[0].clips[0]
      useTimelineStore.getState().moveClip(clip.id, 10)
      const stackBefore = useTimelineStore.getState().undoStack.length

      // time === outputStart (not strictly inside clip)
      useTimelineStore.getState().splitAt(10)
      expect(useTimelineStore.getState().tracks[0].clips).toHaveLength(1)
      expect(useTimelineStore.getState().undoStack.length).toBe(stackBefore)
    })
  })

  // ── addSourceFile — edge cases ───────────────────────────────────────────────

  describe('addSourceFile — same path, different duration', () => {
    it('does not update duration when file already registered (returns existing id)', () => {
      useTimelineStore.getState().addSourceFile('/tmp/a.mp3', 10)
      useTimelineStore.getState().addSourceFile('/tmp/a.mp3', 99)
      const sf = useTimelineStore.getState().sourceFiles[0]
      expect(sf.duration).toBe(10)  // original duration preserved
    })
  })
  ```

- [ ] **Step 2: Run tests — verify they fail**

  ```bash
  npm test -- src/renderer/src/stores/timeline.store.test.ts
  ```
  Expected: `addSourceFile` tests fail (method missing); `splitAt` tests fail (output-coord bug).

### 5b — Fix `splitAt`

- [ ] **Step 3: Fix `splitAt` in timeline.store.ts**

  Replace the clip search and split logic inside `splitAt` (lines ~325–349):

  ```typescript
  // Before: const clip = track.clips.find((c) => time > c.sourceStart && time < c.sourceEnd)
  // After:
  const clip = track.clips.find((c) =>
    time > c.outputStart && time < c.outputStart + (c.sourceEnd - c.sourceStart)
  )
  if (clip) { targetTrackId = track.id; targetClip = clip; break }
  ```

  Replace the `left`/`right` construction (after the `const before = cloneTracks(tracks)` line):

  ```typescript
  const left: Clip = {
    ...targetClip,
    id: nextId('clip'),
    sourceEnd: targetClip.sourceStart + (time - targetClip.outputStart),
    // outputStart unchanged — left clip starts where it always started
  }
  const right: Clip = {
    ...targetClip,
    id: nextId('clip'),
    sourceStart: targetClip.sourceStart + (time - targetClip.outputStart),
    outputStart: time,
  }
  ```

### 5c — Add `addSourceFile`

- [ ] **Step 4: Add `addSourceFile` to the interface and implementation**

  In the `TimelineState` interface, add after `loadFromProject`:

  ```typescript
  /**
   * Register a source file in the project. Idempotent — calling with the same
   * filePath returns the existing id without creating a duplicate.
   * id is always set to filePath (matches the convention in initFromFile).
   * Not undoable.
   */
  addSourceFile(filePath: string, duration: number): string
  ```

  In the store implementation, add after `loadFromProject`:

  ```typescript
  // ── addSourceFile ────────────────────────────────────────────────────────
  addSourceFile(filePath, duration) {
    const existing = get().sourceFiles.find((sf) => sf.filePath === filePath)
    if (existing) {
      console.log(`[Timeline] addSourceFile — already registered id=${existing.id}`)
      return existing.id
    }
    const sf: SourceFile = { id: filePath, filePath, duration }
    console.log(`[Timeline] addSourceFile — registered id=${filePath} duration=${duration.toFixed(2)}s`)
    set((s) => ({ sourceFiles: [...s.sourceFiles, sf] }))
    return filePath
  },
  ```

- [ ] **Step 5: Run all tests — verify they pass**

  ```bash
  npm test -- src/renderer/src/stores/timeline.store.test.ts
  ```
  Expected: 8 tests PASS.

- [ ] **Step 6: Typecheck**

  ```bash
  npm run typecheck
  ```

- [ ] **Step 7: Commit**

  ```bash
  git add src/renderer/src/stores/timeline.store.ts src/renderer/src/stores/timeline.store.test.ts
  git commit -m "fix(store): correct splitAt to use output coordinates; add addSourceFile"
  ```

---

## Task 6: Update `App.tsx` — multi-track generate + backfill

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Import `mergeTrackWords`**

  At the top of `App.tsx`, add:
  ```typescript
  import { mergeTrackWords } from './utils/transcript'
  ```

- [ ] **Step 2: Backfill `word.sourceFileId` in `handleOpenProject`**

  Inside `handleOpenProject`, just after `if (project.transcript) setWords(project.transcript.words)`, add:

  ```typescript
  // Backfill sourceFileId for legacy words (projects saved before Phase 3)
  if (project.transcript?.words) {
    // project.sourceFiles[0]?.id is the absolute path (matches SourceFile.id convention).
    // project.source.file is a relative path (legacy AudioSourceSchema field) — used
    // only as a last-resort fallback for Phase 0/1 projects where sourceFiles[] is empty.
    // In that edge case the sourceFileId will be a relative path that won't match any
    // SourceFile.id, but the word will still render (filter only excludes when filter is set).
    const primarySfId = project.sourceFiles[0]?.id ?? project.source.file
    if (!project.sourceFiles[0]?.id) {
      console.warn('[App] handleOpenProject: sourceFiles[] empty — backfilling words with relative path', primarySfId)
    }
    const backfilled = project.transcript.words.map((w) =>
      w.sourceFileId ? w : { ...w, sourceFileId: primarySfId }
    )
    setWords(backfilled)
  }
  ```

  Remove the original `if (project.transcript) setWords(project.transcript.words)` line (the backfill replaces it).

- [ ] **Step 3: Rewrite `handleGenerateTranscript`**

  Replace the existing `handleGenerateTranscript` (lines ~401–414) with:

  ```typescript
  const handleGenerateTranscript = useCallback(async (trackId?: string) => {
    const reason = await window.electronAPI.transcript.checkAvailability()
    if (reason) { handleError(new Error(reason)); return }

    // Two-step lookup: track id → sourceFileId → SourceFile
    const { tracks: currentTracks, sourceFiles: currentSFs } = useTimelineStore.getState()
    let sf: ReturnType<typeof currentSFs.find>
    if (trackId) {
      const track = currentTracks.find((t) => t.id === trackId)
      const sfId = track?.clips[0]?.sourceFileId
      sf = currentSFs.find((s) => s.id === sfId)
    } else {
      sf = currentSFs[0]
    }
    if (!sf) return

    setIsGenerating(true)
    setGeneratingStatus('Starting…')
    try {
      const transcript = await window.electronAPI.transcript.generate(sf.filePath)
      const taggedWords = transcript.words.map((w) => ({ ...w, sourceFileId: sf!.id }))
      // Read from store — not from closed-over `words` to avoid stale closure
      const currentWords = useTranscriptStore.getState().words
      setWords(mergeTrackWords(currentWords, taggedWords, sf.id))
      setIsDirty(true)
    } catch (err) { handleError(err) }
    finally { setIsGenerating(false); setGeneratingStatus('') }
  }, [setIsGenerating, setGeneratingStatus, setWords, setIsDirty, handleError])
  ```

- [ ] **Step 4: Update `TranscriptPanel` call site**

  In the JSX where `<TranscriptPanel>` is rendered, the `onGenerate` prop already passes `handleGenerateTranscript`. No change needed to the call site — the signature is now `(trackId?: string) => void` which is backward compatible with the `() => void` call from `EmptyTranscriptState`.

- [ ] **Step 5: Typecheck**

  ```bash
  npm run typecheck
  ```
  Expected: error on `TranscriptPanel` prop `onGenerate` type mismatch — will be fixed in Task 9.

- [ ] **Step 6: Commit (without typecheck passing yet — note in message)**

  ```bash
  git add src/renderer/src/App.tsx
  git commit -m "feat(app): multi-track handleGenerateTranscript; backfill word.sourceFileId on project open"
  ```

---

## Task 7: New `TrackHeader` component

**Files:**
- Create: `src/renderer/src/components/Waveform/TrackHeader.tsx`

- [ ] **Step 1: Create the component**

  ```typescript
  // ─────────────────────────────────────────────────────────────────────────────
  // TrackHeader
  //
  // Fixed-width (~90px) left-side header for a single track lane.
  // Contains: editable name, mute toggle, solo toggle, volume slider,
  // color swatch (read-only display), and remove button.
  //
  // All mutations go through timeline.store (updateTrack / removeTrack).
  // Mute and Solo are click-only — no keyboard shortcuts to avoid conflict
  // with the global S = Split shortcut.
  // ─────────────────────────────────────────────────────────────────────────────

  import React, { useState, useCallback } from 'react'
  import type { Track } from '@shared/project.types'
  import { useTimelineStore } from '../../stores/timeline.store'

  interface TrackHeaderProps {
    track: Track
    /** Called when user clicks Remove — parent decides whether to confirm. */
    onRemove: (trackId: string) => void
  }

  export function TrackHeader({ track, onRemove }: TrackHeaderProps) {
    const updateTrack = useTimelineStore((s) => s.updateTrack)
    const [editing, setEditing] = useState(false)
    const [nameInput, setNameInput] = useState(track.name)

    const commitName = useCallback(() => {
      setEditing(false)
      const trimmed = nameInput.trim()
      if (trimmed && trimmed !== track.name) {
        updateTrack(track.id, { name: trimmed })
      } else {
        setNameInput(track.name)  // revert if empty or unchanged
      }
    }, [nameInput, track.id, track.name, updateTrack])

    return (
      <div
        style={{
          width: 90,
          flexShrink: 0,
          borderRight: '1px solid var(--color-border)',
          borderBottom: '1px solid var(--color-border)',
          padding: '4px 6px',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          backgroundColor: 'var(--color-bg-secondary)',
          userSelect: 'none',
        }}
      >
        {/* Track name */}
        {editing ? (
          <input
            autoFocus
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName()
              if (e.key === 'Escape') { setNameInput(track.name); setEditing(false) }
              e.stopPropagation()  // prevent global keyboard shortcuts
            }}
            style={{
              background: 'var(--color-bg-elevated)',
              border: '1px solid var(--color-accent)',
              borderRadius: 3,
              color: 'var(--color-text-primary)',
              fontSize: 'var(--text-xs)',
              padding: '1px 4px',
              width: '100%',
              outline: 'none',
            }}
          />
        ) : (
          <div
            onDoubleClick={() => setEditing(true)}
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              cursor: 'default',
              padding: '1px 0',
            }}
            title={track.name}
          >
            {track.name}
          </div>
        )}

        {/* Color swatch */}
        <div
          style={{
            width: 16,
            height: 4,
            borderRadius: 2,
            backgroundColor: track.color,
            alignSelf: 'flex-start',
          }}
        />

        {/* Mute / Solo */}
        <div style={{ display: 'flex', gap: 3 }}>
          <button
            onClick={() => updateTrack(track.id, { muted: !track.muted })}
            title={track.muted ? 'Unmute' : 'Mute'}
            style={{
              flex: 1,
              fontSize: 9,
              padding: '1px 0',
              border: '1px solid var(--color-border)',
              borderRadius: 2,
              cursor: 'pointer',
              backgroundColor: track.muted ? 'rgba(239,68,68,0.3)' : 'var(--color-bg-elevated)',
              color: track.muted ? 'var(--color-danger)' : 'var(--color-text-muted)',
            }}
          >
            M
          </button>
          <button
            onClick={() => updateTrack(track.id, { solo: !track.solo })}
            title={track.solo ? 'Un-solo' : 'Solo'}
            style={{
              flex: 1,
              fontSize: 9,
              padding: '1px 0',
              border: '1px solid var(--color-border)',
              borderRadius: 2,
              cursor: 'pointer',
              backgroundColor: track.solo ? 'rgba(99,102,241,0.3)' : 'var(--color-bg-elevated)',
              color: track.solo ? 'var(--color-accent)' : 'var(--color-text-muted)',
            }}
          >
            S
          </button>
        </div>

        {/* Volume slider */}
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={track.volume}
          onChange={(e) => updateTrack(track.id, { volume: parseFloat(e.target.value) })}
          style={{ width: '100%', accentColor: track.color, cursor: 'pointer' }}
          title={`Volume: ${Math.round(track.volume * 100)}%`}
        />

        {/* Remove */}
        <button
          onClick={() => onRemove(track.id)}
          title="Remove track"
          style={{
            alignSelf: 'flex-end',
            background: 'none',
            border: 'none',
            color: 'var(--color-text-muted)',
            fontSize: 14,
            lineHeight: 1,
            cursor: 'pointer',
            padding: '0 2px',
          }}
        >
          ×
        </button>
      </div>
    )
  }
  ```

- [ ] **Step 2: Typecheck**

  ```bash
  npm run typecheck
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add src/renderer/src/components/Waveform/TrackHeader.tsx
  git commit -m "feat(ui): add TrackHeader component with name/mute/solo/volume/remove"
  ```

---

## Task 8: Rewrite `WaveformView` — multi-track layout

**Files:**
- Modify: `src/renderer/src/components/Waveform/WaveformView.tsx`

This is the largest task. The current `WaveformView` is a single-track component. We replace it with a multi-track layout: a shared timeline ruler at the top, then per-track rows (TrackHeader + clip lane with its own WaveSurfer), then a "+ Add Track" row at the bottom.

> **No TDD for this task** — WaveSurfer and Electron APIs are not reachable from the vitest node environment.

- [ ] **Step 1: Replace the component with the multi-track layout**

  Rewrite `src/renderer/src/components/Waveform/WaveformView.tsx` entirely:

  ```typescript
  // ─────────────────────────────────────────────────────────────────────────────
  // WaveformView — multi-track
  //
  // Layout:
  //   ┌─ Timeline ruler ──────────────────────────────────────────────────────┐
  //   ├─ [TrackHeader 90px] ── [ClipLane, one WaveSurfer] ───────────────────┤
  //   │   (repeats per track)                                                 │
  //   ├─ + Add Track ─────────────────────────────────────────────────────────┤
  //   └───────────────────────────────────────────────────────────────────────┘
  //
  // Architecture:
  //   • One WaveSurfer instance per track, peaks-only (no media element).
  //   • All WaveSurfer instances share the same onSeek callback.
  //   • Shared playhead = a single absolutely-positioned div that spans all lanes.
  //   • Per-track loading state: Map<trackId, 'loading' | PeakData> (local state,
  //     NOT in the global loadingState — that controls the full-page skeleton).
  //   • Clip blocks are absolutely-positioned <div>s: left = outputStart/duration * 100%,
  //     width = clipDuration/duration * 100%. Muted = red background.
  //   • Clip drag: pointer events on clip block → moveClip() on pointer up.
  //     Ghost copy shown at drag position. Snap within 5px of adjacent clip edges.
  //
  // Preview mode (muted-clip skip) is handled here via onTimeUpdate, same as before.
  // Split markers are rendered as absolutely-positioned 2px lines, same as before.
  //
  // Log prefix: [WaveformView]
  // ─────────────────────────────────────────────────────────────────────────────

  import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
  import WaveSurfer from 'wavesurfer.js'
  import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline.js'
  import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.js'
  import type { PeakData, Clip, Track } from '@shared/project.types'
  import { getAudioPlayerInstance } from '@shared/player.types'
  import { useEditorStore } from '../../stores/editor.store'
  import { useTimelineStore } from '../../stores/timeline.store'
  import { usePlaybackStore } from '../../stores/playback.store'
  import { TrackHeader } from './TrackHeader'

  interface WaveformViewProps {
    /** Primary track's peaks (loaded before WaveformView mounts). */
    peaks: PeakData
  }

  // ── Track loading state ────────────────────────────────────────────────────────
  type TrackPeakState = 'loading' | PeakData

  export function WaveformView({ peaks }: WaveformViewProps) {
    const tracks         = useTimelineStore((s) => s.tracks)
    const sourceFiles    = useTimelineStore((s) => s.sourceFiles)
    const addSourceFile  = useTimelineStore((s) => s.addSourceFile)
    const addTrack       = useTimelineStore((s) => s.addTrack)
    const removeTrack    = useTimelineStore((s) => s.removeTrack)
    const moveClip       = useTimelineStore((s) => s.moveClip)
    const selectedClipId = useTimelineStore((s) => s.selectedClipId)
    const setSelectedClipId = useTimelineStore((s) => s.setSelectedClipId)

    const currentTime  = usePlaybackStore((s) => s.currentTime)
    const duration     = peaks.durationSeconds  // use primary peaks duration as timeline length

    const previewMode  = useEditorStore((s) => s.previewMode)
    const setSelection = useEditorStore((s) => s.setSelection)

    // Per-track peak loading state (secondary tracks only; primary uses `peaks` prop)
    const [trackPeaks, setTrackPeaks] = useState<Map<string, TrackPeakState>>(() => {
      const m = new Map<string, TrackPeakState>()
      if (tracks.length > 0) m.set(tracks[0].id, peaks)  // primary track pre-loaded
      return m
    })

    // Sync primary peaks if they change (e.g. new file opened)
    useEffect(() => {
      if (tracks.length > 0) {
        setTrackPeaks((prev) => new Map(prev).set(tracks[0].id, peaks))
      }
    }, [peaks, tracks])

    // ── Shared playhead position ──────────────────────────────────────────────
    const playheadPct = duration > 0 ? (currentTime / duration) * 100 : 0

    // ── Preview mode skip ─────────────────────────────────────────────────────
    const previewModeRef = useRef(previewMode)
    useEffect(() => { previewModeRef.current = previewMode }, [previewMode])

    useEffect(() => {
      const player = getAudioPlayerInstance()
      if (!player) return
      return player.onTimeUpdate((t) => {
        if (!previewModeRef.current) return
        const { tracks: currentTracks } = useTimelineStore.getState()
        const hit = currentTracks.flatMap((tr) => tr.clips as Clip[]).find((c) => {
          if (!c.muted) return false
          const outputEnd = c.outputStart + (c.sourceEnd - c.sourceStart)
          return t >= c.outputStart && t < outputEnd
        })
        if (hit) {
          const outputEnd = hit.outputStart + (hit.sourceEnd - hit.sourceStart)
          getAudioPlayerInstance()?.seekTo(outputEnd)
        }
      })
    }, [])

    // ── Seek on lane click ────────────────────────────────────────────────────
    const handleLaneClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect()
      const pct  = (e.clientX - rect.left) / rect.width
      const t    = pct * duration
      getAudioPlayerInstance()?.seekTo(t)
    }, [duration])

    // ── Add Track ────────────────────────────────────────────────────────────
    const handleAddTrack = useCallback(async () => {
      const result = await window.electronAPI.audio.openFile()
      if (!result) return
      const sfId = addSourceFile(result.filePath, result.metadata.durationSeconds)
      const trackId = addTrack(`Track ${tracks.length + 1}`, sfId)
      // Register the new source in the active player
      getAudioPlayerInstance()?.loadSourceFile(sfId, result.filePath).catch(console.warn)
      // Generate peaks for the new track (per-track loading — not full-page skeleton)
      setTrackPeaks((prev) => new Map(prev).set(trackId, 'loading'))
      try {
        const pd = await window.electronAPI.audio.generatePeaks(result.filePath)
        setTrackPeaks((prev) => new Map(prev).set(trackId, pd))
      } catch (err) {
        console.error('[WaveformView] Failed to generate peaks for new track:', err)
        setTrackPeaks((prev) => { const m = new Map(prev); m.delete(trackId); return m })
      }
    }, [addSourceFile, addTrack, tracks.length])

    // ── Remove track ─────────────────────────────────────────────────────────
    const handleRemoveTrack = useCallback((trackId: string) => {
      removeTrack(trackId)
      setTrackPeaks((prev) => { const m = new Map(prev); m.delete(trackId); return m })
    }, [removeTrack])

    // ── Clip drag ─────────────────────────────────────────────────────────────
    // dragState holds: clipId, original outputStart, current ghost position
    const dragRef = useRef<{
      clipId:     string
      origStart:  number
      ghostPct:   number
      trackId:    string
      startX:     number
    } | null>(null)
    const [ghostState, setGhostState] = useState<{ pct: number; widthPct: number } | null>(null)

    const handleClipPointerDown = useCallback((
      e: React.PointerEvent,
      clip: Clip,
      laneWidth: number,
    ) => {
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      dragRef.current = {
        clipId:    clip.id,
        origStart: clip.outputStart,
        ghostPct:  (clip.outputStart / duration) * 100,
        trackId:   clip.trackId,
        startX:    e.clientX,
      }
      const widthPct = ((clip.sourceEnd - clip.sourceStart) / duration) * 100
      setGhostState({ pct: (clip.outputStart / duration) * 100, widthPct })
    }, [duration])

    const handleClipPointerMove = useCallback((e: React.PointerEvent) => {
      if (!dragRef.current) return
      const delta  = e.clientX - dragRef.current.startX
      const laneEl = (e.currentTarget as HTMLDivElement).closest('[data-lane]') as HTMLDivElement
      const laneW  = laneEl?.getBoundingClientRect().width ?? 1
      const deltaPct = (delta / laneW) * 100
      const newPct   = Math.max(0, dragRef.current.ghostPct + deltaPct)
      setGhostState((g) => g ? { ...g, pct: newPct } : null)
    }, [])

    const handleClipPointerUp = useCallback((e: React.PointerEvent) => {
      if (!dragRef.current || !ghostState) { dragRef.current = null; setGhostState(null); return }
      const laneEl = (e.currentTarget as HTMLDivElement).closest('[data-lane]') as HTMLDivElement
      const laneW  = laneEl?.getBoundingClientRect().width ?? 1
      const newOutputStart = (ghostState.pct / 100) * duration

      // Snap: find if leading/trailing edge is within 5px of another clip's edge
      const { tracks: allTracks } = useTimelineStore.getState()
      const allEdges = allTracks.flatMap((t) =>
        t.clips
          .filter((c) => c.id !== dragRef.current!.clipId)
          .flatMap((c) => [
            c.outputStart,
            c.outputStart + (c.sourceEnd - c.sourceStart),
          ])
      )
      const snapThresholdSec = (5 / laneW) * duration
      const clipped = useTimelineStore.getState().tracks
        .flatMap((t) => t.clips)
        .find((c) => c.id === dragRef.current!.clipId)
      const clipDur = clipped ? clipped.sourceEnd - clipped.sourceStart : 0
      let snapped = newOutputStart
      for (const edge of allEdges) {
        if (Math.abs(newOutputStart - edge) < snapThresholdSec) { snapped = edge; break }
        if (Math.abs(newOutputStart + clipDur - edge) < snapThresholdSec) { snapped = edge - clipDur; break }
      }

      moveClip(dragRef.current.clipId, Math.max(0, snapped))
      dragRef.current = null
      setGhostState(null)
    }, [ghostState, duration, moveClip])

    // ── Render ────────────────────────────────────────────────────────────────
    return (
      <div style={{ display: 'flex', flexDirection: 'column', backgroundColor: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border)', position: 'relative' }}>

        {/* Shared timeline ruler (spans the clip lanes only, not the headers) */}
        <div style={{ display: 'flex' }}>
          <div style={{ width: 90, flexShrink: 0, borderRight: '1px solid var(--color-border)' }} />
          <div id="waveform-timeline" style={{ flex: 1, borderBottom: '1px solid var(--color-border-subtle)' }} />
        </div>

        {/* Track rows */}
        {tracks.map((track, trackIndex) => {
          const peakState = trackPeaks.get(track.id)
          const trackPeakData = peakState === 'loading' || peakState === undefined ? null : peakState
          return (
            <div key={track.id} style={{ display: 'flex', borderBottom: '1px solid var(--color-border)' }}>
              <TrackHeader track={track} onRemove={handleRemoveTrack} />
              {/* Clip lane */}
              <div
                data-lane={track.id}
                data-trackid={track.id}
                style={{ flex: 1, position: 'relative', height: 96, cursor: 'crosshair', overflow: 'hidden' }}
                onClick={handleLaneClick}
                onPointerMove={handleClipPointerMove}
                onPointerUp={handleClipPointerUp}
              >
                {peakState === 'loading' && (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Generating waveform…</span>
                  </div>
                )}
                {/* WaveSurfer canvas for this track */}
                {trackPeakData && (
                  <TrackWaveform
                    key={track.id}
                    trackId={track.id}
                    peaks={trackPeakData}
                    color={track.color}
                    trackIndex={trackIndex}
                  />
                )}
                {/* Clip blocks */}
                {track.clips.map((clip) => {
                  const clipDur    = clip.sourceEnd - clip.sourceStart
                  const leftPct    = duration > 0 ? (clip.outputStart / duration) * 100 : 0
                  const widthPct   = duration > 0 ? (clipDur / duration) * 100 : 0
                  const isDragging = dragRef.current?.clipId === clip.id
                  return (
                    <div
                      key={clip.id}
                      onPointerDown={(e) => {
                        const laneW = (e.currentTarget.parentElement?.getBoundingClientRect().width ?? 1)
                        handleClipPointerDown(e, clip, laneW)
                      }}
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelectedClipId(clip.id === selectedClipId ? null : clip.id)
                        setSelection({ start: clip.outputStart, end: clip.outputStart + clipDur })
                      }}
                      style={{
                        position:        'absolute',
                        left:            `${leftPct}%`,
                        width:           `${widthPct}%`,
                        top:             4,
                        bottom:          4,
                        borderRadius:    3,
                        border:          clip.id === selectedClipId
                          ? '1px solid var(--color-accent)'
                          : '1px solid transparent',
                        backgroundColor: clip.muted
                          ? 'rgba(239, 68, 68, 0.22)'
                          : 'transparent',
                        opacity:         isDragging ? 0.4 : 1,
                        cursor:          'grab',
                        pointerEvents:   'all',
                        zIndex:          isDragging ? 0 : 5,
                        boxSizing:       'border-box',
                      }}
                    />
                  )
                })}
                {/* Drag ghost */}
                {ghostState && dragRef.current && track.clips.some((c) => c.id === dragRef.current!.clipId) && (
                  <div style={{
                    position:        'absolute',
                    left:            `${ghostState.pct}%`,
                    width:           `${ghostState.widthPct}%`,
                    top:             4,
                    bottom:          4,
                    borderRadius:    3,
                    border:          '1px dashed var(--color-accent)',
                    backgroundColor: 'rgba(99,102,241,0.2)',
                    pointerEvents:   'none',
                    zIndex:          20,
                  }} />
                )}
                {/* Split markers */}
                {track.clips
                  .slice(1)
                  .map((clip) => (
                    <div
                      key={`split-${clip.id}`}
                      style={{
                        position:        'absolute',
                        top:             0,
                        bottom:          0,
                        left:            duration > 0 ? `calc(${(clip.outputStart / duration) * 100}% - 1px)` : 0,
                        width:           2,
                        backgroundColor: 'rgba(99, 102, 241, 0.85)',
                        pointerEvents:   'none',
                        zIndex:          10,
                      }}
                    />
                  ))}
                {/* Shared playhead line */}
                <div
                  style={{
                    position:        'absolute',
                    top:             0,
                    bottom:          0,
                    left:            `${playheadPct}%`,
                    width:           1,
                    backgroundColor: 'rgba(255,255,255,0.7)',
                    pointerEvents:   'none',
                    zIndex:          30,
                  }}
                />
              </div>
            </div>
          )
        })}

        {/* + Add Track row */}
        <div
          onClick={handleAddTrack}
          style={{
            display:         'flex',
            alignItems:      'center',
            padding:         '6px 12px',
            cursor:          'pointer',
            color:           'var(--color-text-muted)',
            fontSize:        'var(--text-xs)',
            borderTop:       '1px solid var(--color-border)',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-accent)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-text-muted)')}
        >
          + Add Track
        </div>
      </div>
    )
  }

  // ── TrackWaveform — per-track WaveSurfer instance ─────────────────────────────
  // Isolated component so each track gets its own WaveSurfer lifecycle.

  interface TrackWaveformProps {
    trackId:    string
    peaks:      PeakData
    color:      string
    trackIndex: number
  }

  function TrackWaveform({ trackId, peaks, color, trackIndex }: TrackWaveformProps) {
    const containerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
      if (!containerRef.current) return

      const timelinePluginOptions = trackIndex === 0
        ? {
            container: '#waveform-timeline',
            timeInterval: 10,
            primaryLabelInterval: 60,
            style: { fontSize: '10px', color: 'var(--color-text-muted)' },
          }
        : undefined

      const plugins = timelinePluginOptions
        ? [TimelinePlugin.create(timelinePluginOptions)]
        : []

      const ws = WaveSurfer.create({
        container:     containerRef.current,
        waveColor:     color,
        progressColor: color + '99',
        cursorWidth:   0,    // playhead rendered by parent, not WaveSurfer
        barWidth:      2,
        barGap:        1,
        barRadius:     2,
        height:        88,
        peaks:         peaks.data,
        duration:      peaks.durationSeconds,
        plugins,
      })

      ws.on('interaction', (t: number) => {
        getAudioPlayerInstance()?.seekTo(t)
      })

      console.log(`[WaveformView] WaveSurfer ready for track ${trackId}`)

      return () => {
        ws.destroy()
      }
    }, [peaks, color, trackId, trackIndex])

    return <div ref={containerRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
  }

  // ── Module-level handles (kept for backward-compat with existing call sites) ───
  let _wsInstance: WaveSurfer | null = null
  let _regionsInstance: ReturnType<typeof RegionsPlugin.create> | null = null

  export function getWaveSurferInstance(): WaveSurfer | null { return _wsInstance }
  export function setWaveSurferInstance(ws: WaveSurfer | null): void { _wsInstance = ws }
  export function getRegionsPluginInstance() { return _regionsInstance }
  export function setRegionsPluginInstance(r: typeof _regionsInstance): void { _regionsInstance = r }
  ```

- [ ] **Step 2: Typecheck**

  ```bash
  npm run typecheck
  ```
  Fix any type errors reported. Common ones: `loadSourceFile` may not exist on `IAudioPlayer` — check `player.types.ts` and use the correct method name.

- [ ] **Step 3: Commit**

  ```bash
  git add src/renderer/src/components/Waveform/WaveformView.tsx
  git commit -m "feat(ui): rewrite WaveformView for multi-track layout with clip drag"
  ```

---

## Task 9: Update `TranscriptPanel` — track filter pills + fixes

**Files:**
- Modify: `src/renderer/src/components/Transcript/TranscriptPanel.tsx`

- [ ] **Step 1: Update the `onGenerate` prop type**

  Change line 33:
  ```typescript
  // Before:
  onGenerate: () => void
  // After:
  onGenerate: (trackId?: string) => void
  ```

- [ ] **Step 2: Import `useTimelineStore` and `activeTrackFilter`**

  The component already imports `useTimelineStore`. Add to the store subscriptions at the top of the function body:

  ```typescript
  const activeTrackFilter   = useTranscriptStore((s) => s.activeTrackFilter)
  const setActiveTrackFilter = useTranscriptStore((s) => s.setActiveTrackFilter)
  const tracks               = useTimelineStore((s) => s.tracks)
  const sourceFiles          = useTimelineStore((s) => s.sourceFiles)
  ```

- [ ] **Step 3: Update `visibleWords` derivation**

  Replace line 184:
  ```typescript
  // Before:
  const visibleWords = showMutedWords ? words : words.filter((w) => !w.muted)
  // After:
  const visibleWords = words
    .filter((w) => !activeTrackFilter || w.sourceFileId === activeTrackFilter)
    .filter((w) => showMutedWords || !w.muted)
  ```

- [ ] **Step 4: Fix `handleDeleteFromSelection` — route via `word.sourceFileId`**

  In `handleDeleteFromSelection`, replace the `sfId` line (line ~142–144):
  ```typescript
  // Before:
  const { sourceFiles, muteRange } = useTimelineStore.getState()
  const sfId = sourceFiles[0]?.id
  // After:
  const { sourceFiles, muteRange } = useTimelineStore.getState()
  const sfId = selected[0]?.sourceFileId ?? sourceFiles[0]?.id
  ```

- [ ] **Step 5: Add the track filter pills header row**

  After the closing `</div>` of the existing header row (after line ~229), add a second header row. Insert before the `{/* ── Body ── */}` comment:

  ```typescript
  {/* ── Track filter pills (row 2) ─────────────────────────── */}
  {tracks.length > 1 && (
    <div
      style={{
        display:      'flex',
        alignItems:   'center',
        gap:          6,
        padding:      '4px var(--space-3) 6px',
        overflowX:    'auto',
        borderBottom: '1px solid var(--color-border)',
        flexShrink:   0,
      }}
    >
      {/* All pill */}
      <button
        onClick={() => setActiveTrackFilter(null)}
        style={{
          background:   activeTrackFilter === null ? 'var(--color-accent)' : 'var(--color-bg-elevated)',
          border:       activeTrackFilter === null ? 'none' : '1px solid var(--color-border)',
          borderRadius: 10,
          padding:      '2px 10px',
          fontSize:     10,
          color:        activeTrackFilter === null ? '#fff' : 'var(--color-text-muted)',
          cursor:       'pointer',
          flexShrink:   0,
          whiteSpace:   'nowrap',
        }}
      >
        All
      </button>

      {/* Per-track pills */}
      {tracks.map((track) => {
        const trackSfId     = track.clips[0]?.sourceFileId
        const isActive      = activeTrackFilter === trackSfId
        const hasTranscript = words.some((w) => w.sourceFileId === trackSfId)
        return (
          <button
            key={track.id}
            onClick={() => setActiveTrackFilter(isActive ? null : (trackSfId ?? null))}
            style={{
              background:   isActive ? 'var(--color-accent)' : 'var(--color-bg-elevated)',
              border:       '1px solid var(--color-border)',
              borderRadius: 10,
              padding:      '2px 10px',
              fontSize:     10,
              color:        isActive ? '#fff' : 'var(--color-text-muted)',
              cursor:       'pointer',
              flexShrink:   0,
              whiteSpace:   'nowrap',
              display:      'flex',
              alignItems:   'center',
              gap:          5,
            }}
          >
            <span style={{ width: 6, height: 6, background: track.color, borderRadius: '50%', display: 'inline-block', flexShrink: 0 }} />
            {track.name}
            {!hasTranscript && (
              <span
                onClick={(e) => { e.stopPropagation(); onGenerate(track.id) }}
                style={{ color: 'var(--color-text-muted)', fontSize: 9, marginLeft: 2, cursor: 'pointer' }}
                title={`Generate transcript for ${track.name}`}
              >
                + generate
              </span>
            )}
          </button>
        )
      })}

      {/* ⚡ All tracks */}
      <button
        onClick={async () => {
          // Generate sequentially for tracks without a transcript.
          // Must be sequential (not parallel) — concurrent onGenerate calls race
          // on isGenerating state and the second call's finally-block clears the
          // flag while the first is still running.
          for (const track of tracks) {
            const sfId = track.clips[0]?.sourceFileId
            if (sfId && !words.some((w) => w.sourceFileId === sfId)) {
              await onGenerate(track.id)
            }
          }
        }}
        style={{
          marginLeft:   'auto',
          background:   'none',
          border:       '1px solid var(--color-border)',
          borderRadius: 4,
          padding:      '2px 8px',
          fontSize:     10,
          color:        'var(--color-text-muted)',
          cursor:       'pointer',
          flexShrink:   0,
          whiteSpace:   'nowrap',
        }}
        title="Generate transcripts for all tracks that don't have one"
      >
        ⚡ All tracks
      </button>
    </div>
  )}
  ```

- [ ] **Step 6: Update word span style for multi-track opacity**

  In the `visibleWords.map` render, update the span's `opacity` style to dim non-primary track words:

  ```typescript
  // Find primary source file id for opacity calculation
  const primarySfId = sourceFiles[0]?.id

  // Inside the span style:
  opacity: word.muted
    ? 0.45
    : (!word.sourceFileId || word.sourceFileId === primarySfId)
      ? 1
      : 0.6,
  ```

  Place the `primarySfId` computation just before the `return (` in the render function.

- [ ] **Step 7: Typecheck**

  ```bash
  npm run typecheck
  ```
  Expected: 0 errors (including the App.tsx mismatch from Task 6 now resolved).

- [ ] **Step 8: Commit**

  ```bash
  git add src/renderer/src/components/Transcript/TranscriptPanel.tsx
  git commit -m "feat(transcript): add track filter pills; fix delete-to-mute routing via word.sourceFileId"
  ```

---

## Task 10: FFmpeg filter-graph builder — TDD

**Files:**
- Create: `src/main/audio/renderer.ts`
- Create: `src/main/audio/renderer.test.ts`

- [ ] **Step 1: Write the failing tests**

  Create `src/main/audio/renderer.test.ts`:

  ```typescript
  import { describe, it, expect } from 'vitest'
  import { buildRenderArgs } from './renderer'
  import type { ProjectFile } from '@shared/project.types'

  // Minimal project factory
  function makeProject(clips: {
    sfIdx: number      // index into sourceFiles
    sourceStart: number
    sourceEnd: number
    outputStart: number
    muted?: boolean
  }[]): ProjectFile {
    const sourceFiles = [
      { id: '/tmp/a.mp3', filePath: '/tmp/a.mp3', duration: 30 },
      { id: '/tmp/b.mp3', filePath: '/tmp/b.mp3', duration: 30 },
    ]
    const trackClips = clips.map((c, i) => ({
      id:           `clip-${i}`,
      trackId:      'track-0',
      sourceFileId: sourceFiles[c.sfIdx].id,
      sourceStart:  c.sourceStart,
      sourceEnd:    c.sourceEnd,
      outputStart:  c.outputStart,
      gain:         1,
      muted:        c.muted ?? false,
      effects:      [],
    }))
    return {
      version:     1,
      createdAt:   '2026-01-01T00:00:00.000Z',
      source:      { file: '/tmp/a.mp3', sampleRate: 44100, channels: 2, durationSeconds: 30 },
      edits:       [],
      adjustments: [],
      markers:     [],
      export:      { targetLUFS: -16, truePeakDbTP: -1.5, format: 'mp3', sampleRate: 48000 },
      pluginData:  {},
      sourceFiles,
      tracks:      [{
        id:      'track-0',
        name:    'Voice',
        clips:   trackClips,
        volume:  1,
        muted:   false,
        solo:    false,
        color:   '#4f46e5',
        effects: [],
      }],
    } as unknown as ProjectFile
  }

  describe('buildRenderArgs', () => {
    it('returns ffmpeg args array including -filter_complex, -map, and output path', () => {
      const project = makeProject([{ sfIdx: 0, sourceStart: 0, sourceEnd: 5, outputStart: 0 }])
      const args = buildRenderArgs(project, '/tmp/out.mp3')
      expect(args).toContain('-filter_complex')
      expect(args).toContain('-map')
      expect(args[args.length - 1]).toBe('/tmp/out.mp3')
    })

    it('excludes muted clips', () => {
      const project = makeProject([
        { sfIdx: 0, sourceStart: 0, sourceEnd: 5, outputStart: 0 },
        { sfIdx: 0, sourceStart: 5, sourceEnd: 10, outputStart: 5, muted: true },
        { sfIdx: 0, sourceStart: 10, sourceEnd: 15, outputStart: 10 },
      ])
      const args = buildRenderArgs(project, '/tmp/out.mp3')
      const fc = args[args.indexOf('-filter_complex') + 1]
      // 2 non-muted clips → concat n=2
      expect(fc).toContain('concat=n=2')
    })

    it('skips fully-muted tracks and does not include them in amix', () => {
      const project = makeProject([
        { sfIdx: 0, sourceStart: 0, sourceEnd: 5, outputStart: 0 },
      ])
      // Manually add a second track with all muted clips
      project.tracks.push({
        id: 'track-1', name: 'Music',
        clips: [{ id: 'clip-m', trackId: 'track-1', sourceFileId: '/tmp/b.mp3',
          sourceStart: 0, sourceEnd: 5, outputStart: 0, gain: 1, muted: true, effects: [] }],
        volume: 1, muted: false, solo: false, color: '#10b981', effects: [],
      })
      const args = buildRenderArgs(project, '/tmp/out.mp3')
      const fc = args[args.indexOf('-filter_complex') + 1]
      // Only 1 active track — no amix=inputs=2, and -map must be present
      expect(fc).not.toContain('amix=inputs=2')
      expect(args).toContain('-map')
      expect(fc.length).toBeGreaterThan(0)
    })

    it('throws when all clips are muted', () => {
      const project = makeProject([
        { sfIdx: 0, sourceStart: 0, sourceEnd: 5, outputStart: 0, muted: true },
      ])
      expect(() => buildRenderArgs(project, '/tmp/out.mp3')).toThrow('No non-muted clips')
    })

    it('uses correct FFmpeg input index for clips from a second source file', () => {
      const project = makeProject([
        { sfIdx: 0, sourceStart: 0, sourceEnd: 5, outputStart: 0 },
        { sfIdx: 1, sourceStart: 0, sourceEnd: 5, outputStart: 5 },
      ])
      const args = buildRenderArgs(project, '/tmp/out.mp3')
      // Both source files should appear as -i inputs
      const iIndices: number[] = []
      args.forEach((a, i) => { if (a === '-i') iIndices.push(i + 1) })
      expect(iIndices).toHaveLength(2)
      const fc = args[args.indexOf('-filter_complex') + 1]
      // Second clip references input 1
      expect(fc).toContain('[1:a]')
    })
  })
  ```

- [ ] **Step 2: Run tests — verify they fail**

  ```bash
  npm test -- src/main/audio/renderer.test.ts
  ```
  Expected: FAIL — `buildRenderArgs` not found.

- [ ] **Step 3: Implement `renderer.ts`**

  Create `src/main/audio/renderer.ts`:

  ```typescript
  // ─────────────────────────────────────────────────────────────────────────────
  // Audio Renderer — FFmpeg filter-graph builder
  //
  // Pure function: takes a ProjectFile snapshot and output path, returns the
  // ffmpeg argument array. No I/O, no side effects — unit-testable.
  //
  // Filter graph shape (see spec §6):
  //   Step 1: Per track, collect non-muted clips sorted by outputStart.
  //           Skip tracks where all clips are muted.
  //   Step 2: Per clip: [SRC:a]atrim=start=S:end=E,asetpts=PTS-STARTPTS[segI]
  //   Step 3: Per active track: [segA][segB]...concat=n=K:v=0:a=1[trackT]
  //   Step 4: [track0][track1]...amix=inputs=T:normalize=0[out]
  //           (if T=1, skip amix and use [track0] directly as [out])
  //
  // Note: clip.gain is intentionally ignored (deferred to Phase 4).
  // ─────────────────────────────────────────────────────────────────────────────

  import type { ProjectFile } from '@shared/project.types'

  // NOTE: No import of `binaries.ts` here — this module is a pure function so it
  // can be unit-tested in the Vitest node environment without Homebrew being present.
  // The ffmpeg binary path is resolved in render.ipc.ts (the call site), not here.

  /** Build the ffmpeg CLI argument array for an export render. Pure function. */
  export function buildRenderArgs(project: ProjectFile, outputPath: string): string[] {
    const { sourceFiles, tracks } = project

    // Map sourceFile.id → FFmpeg input index (0-based, in insertion order)
    const sfIndexMap = new Map<string, number>()
    const inputArgs: string[] = []
    for (const sf of sourceFiles) {
      sfIndexMap.set(sf.id, sfIndexMap.size)
      inputArgs.push('-i', sf.filePath)
    }

    // Collect active tracks (tracks with at least one non-muted clip)
    const activeTrackClips: Array<{ trackIdx: number; clips: NonNullable<ProjectFile['tracks'][0]['clips']> }> = []
    for (let i = 0; i < tracks.length; i++) {
      const nonMuted = tracks[i].clips.filter((c) => !c.muted).sort((a, b) => a.outputStart - b.outputStart)
      if (nonMuted.length > 0) {
        activeTrackClips.push({ trackIdx: i, clips: nonMuted })
      }
    }

    if (activeTrackClips.length === 0) {
      throw new Error('No non-muted clips to export')
    }

    // Build filter_complex string
    const parts: string[] = []
    let segIndex = 0
    const trackLabels: string[] = []

    for (let ti = 0; ti < activeTrackClips.length; ti++) {
      const { clips } = activeTrackClips[ti]
      const segLabels: string[] = []

      for (const clip of clips) {
        const srcIdx = sfIndexMap.get(clip.sourceFileId)
        if (srcIdx === undefined) throw new Error(`Unknown sourceFileId: ${clip.sourceFileId}`)
        const label = `seg${segIndex++}`
        parts.push(`[${srcIdx}:a]atrim=start=${clip.sourceStart}:end=${clip.sourceEnd},asetpts=PTS-STARTPTS[${label}]`)
        segLabels.push(`[${label}]`)
      }

      const trackLabel = `track${ti}`
      if (clips.length === 1) {
        // Single clip — rename label directly
        parts.push(`${segLabels[0]}anull[${trackLabel}]`)
      } else {
        parts.push(`${segLabels.join('')}concat=n=${clips.length}:v=0:a=1[${trackLabel}]`)
      }
      trackLabels.push(`[${trackLabel}]`)
    }

    let outLabel: string
    if (trackLabels.length === 1) {
      // Single active track — use its label directly as the output; no extra filter needed
      outLabel = trackLabels[0]
    } else {
      parts.push(`${trackLabels.join('')}amix=inputs=${trackLabels.length}:normalize=0[out]`)
      outLabel = '[out]'
    }

    const filterComplex = parts.join(';')

    // Determine format-specific encoding args
    const fmt = project.export?.format ?? 'mp3'
    const encodeArgs = formatToEncodeArgs(fmt)

    return [
      ...inputArgs,
      '-filter_complex', filterComplex,
      '-map', outLabel,
      ...encodeArgs,
      outputPath,
    ]
  }

  function formatToEncodeArgs(format: string): string[] {
    switch (format) {
      case 'wav':  return ['-c:a', 'pcm_s16le']
      case 'aac':  return ['-c:a', 'aac', '-b:a', '192k']
      case 'mp3':
      default:     return ['-c:a', 'libmp3lame', '-q:a', '2']
    }
  }
  ```

  `getFfmpegPath()` is **not** in `renderer.ts`. It lives in `render.ipc.ts` (see Task 11), keeping `renderer.ts` free of binary resolution so it can be tested without Homebrew.

- [ ] **Step 4: Run tests — verify they pass**

  ```bash
  npm test -- src/main/audio/renderer.test.ts
  ```
  Expected: 3 tests PASS. If `resolveBinary` import causes issues in the test environment, mock it or move `getFfmpegPath` to a separate export so the pure function doesn't depend on it.

- [ ] **Step 5: Typecheck**

  ```bash
  npm run typecheck
  ```

- [ ] **Step 6: Commit**

  ```bash
  git add src/main/audio/renderer.ts src/main/audio/renderer.test.ts
  git commit -m "feat(main): add FFmpeg filter-graph builder for export pipeline"
  ```

---

## Task 11: Export IPC handler

**Files:**
- Create: `src/main/ipc/render.ipc.ts`

- [ ] **Step 1: Create the handler**

  ```typescript
  // ─────────────────────────────────────────────────────────────────────────────
  // Render IPC Handler
  //
  // Handles project:export — builds the FFmpeg filter graph from the project
  // snapshot, spawns FFmpeg, streams progress events to the renderer.
  // ─────────────────────────────────────────────────────────────────────────────

  import { ipcMain } from 'electron'
  import { spawn }    from 'child_process'
  import type { ProjectFile } from '@shared/project.types'
  import type { RenderProgress } from '@shared/ipc.types'
  import { buildRenderArgs } from '../audio/renderer'
  import { resolveBinary } from '../audio/binaries'

  // getFfmpegPath lives here (not in renderer.ts) so renderer.ts stays import-free
  // and unit-testable without Homebrew being present.
  function getFfmpegPath(): string {
    return resolveBinary('ffmpeg')
  }

  ipcMain.handle('project:export', async (event, project: ProjectFile, outputPath: string) => {
    const args   = buildRenderArgs(project, outputPath)
    const ffmpeg = spawn(getFfmpegPath(), args)

    console.log(`[RenderIPC] spawning ffmpeg: ${getFfmpegPath()} ${args.join(' ')}`)

    await new Promise<void>((resolve, reject) => {
      let stderr = ''

      // Parse duration once from stderr header
      let totalSeconds = 0

      ffmpeg.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString()
        stderr += text

        // Extract total duration (appears once near the start)
        if (totalSeconds === 0) {
          const durationMatch = text.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/)
          if (durationMatch) {
            totalSeconds =
              parseInt(durationMatch[1], 10) * 3600 +
              parseInt(durationMatch[2], 10) * 60 +
              parseFloat(durationMatch[3])
          }
        }

        // Parse current progress: "time=HH:MM:SS.ss"
        const timeMatch = text.match(/time=(\d+):(\d+):(\d+\.\d+)/)
        if (timeMatch && totalSeconds > 0) {
          const currentSeconds =
            parseInt(timeMatch[1], 10) * 3600 +
            parseInt(timeMatch[2], 10) * 60 +
            parseFloat(timeMatch[3])
          const percent = Math.min(1, currentSeconds / totalSeconds)
          const progress: RenderProgress = { percent, currentSeconds, totalSeconds }
          if (!event.sender.isDestroyed()) {
            event.sender.send('render:progress', progress)
          }
        }
      })

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          if (!event.sender.isDestroyed()) {
            event.sender.send('render:progress', { percent: 1, currentSeconds: totalSeconds, totalSeconds })
          }
          resolve()
        } else {
          reject(new Error(`FFmpeg exited with code ${code}:\n${stderr.slice(-500)}`))
        }
      })

      ffmpeg.on('error', reject)
    })
  })
  ```

- [ ] **Step 2: Typecheck**

  ```bash
  npm run typecheck
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add src/main/ipc/render.ipc.ts
  git commit -m "feat(ipc): add project:export handler with FFmpeg progress streaming"
  ```

---

## Task 12: Update preload — expose render namespace

**Files:**
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Add `render.export` and `on.renderProgress`**

  In the `api` object, add after the `transcript` block:

  ```typescript
  render: {
    export: (project: unknown, outputPath: string) =>
      ipcRenderer.invoke('project:export', project, outputPath),
  },
  ```

  In the `on` block, add after `transcriptProgress`:

  ```typescript
  renderProgress: (callback: (p: import('../shared/ipc.types').RenderProgress) => void) => {
    const handler = (_event: IpcRendererEvent, p: import('../shared/ipc.types').RenderProgress) => callback(p)
    ipcRenderer.on('render:progress', handler)
    return () => ipcRenderer.off('render:progress', handler)
  },
  ```

- [ ] **Step 2: Typecheck**

  ```bash
  npm run typecheck
  ```
  Expected: 0 errors — the `satisfies IElectronAPI` guard should now pass.

- [ ] **Step 3: Commit**

  ```bash
  git add src/preload/index.ts
  git commit -m "feat(preload): expose render.export and on.renderProgress"
  ```

---

## Task 13: Register `render.ipc.ts` in main process

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: Add the import**

  After `import './ipc/transcript.ipc'`, add:

  ```typescript
  import './ipc/render.ipc'
  ```

- [ ] **Step 2: Typecheck + build**

  ```bash
  npm run typecheck && npm run build
  ```
  Expected: build succeeds.

- [ ] **Step 3: Commit**

  ```bash
  git add src/main/index.ts
  git commit -m "feat(main): register render IPC handler on startup"
  ```

---

## Task 14: Export modal UI + Export button

**Files:**
- Create: `src/renderer/src/components/Export/ExportModal.tsx`
- Modify: `src/renderer/src/App.tsx` (add export state + button)

- [ ] **Step 1: Create the ExportModal component**

  Create `src/renderer/src/components/Export/ExportModal.tsx`:

  ```typescript
  // ─────────────────────────────────────────────────────────────────────────────
  // ExportModal
  //
  // Triggered from the "Export" button in the transport bar area.
  // Shows: format selector (MP3/WAV/AAC), output path picker, LUFS target (display
  // only — normalization deferred to Phase 4), and a progress bar.
  // ─────────────────────────────────────────────────────────────────────────────

  import React, { useState, useCallback, useEffect } from 'react'
  import type { ProjectFile } from '@shared/project.types'
  import type { RenderProgress } from '@shared/ipc.types'

  interface ExportModalProps {
    project:  ProjectFile
    onClose:  () => void
  }

  type ExportState =
    | { status: 'idle' }
    | { status: 'exporting'; progress: RenderProgress }
    | { status: 'done' }
    | { status: 'error'; message: string }

  export function ExportModal({ project, onClose }: ExportModalProps) {
    const [format,     setFormat]     = useState<'mp3' | 'wav' | 'aac'>('mp3')
    const [outputPath, setOutputPath] = useState('')
    const [exportState, setExportState] = useState<ExportState>({ status: 'idle' })

    // Subscribe to render progress events
    useEffect(() => {
      return window.electronAPI.on.renderProgress((p) => {
        setExportState({ status: 'exporting', progress: p })
        if (p.percent >= 1) setExportState({ status: 'done' })
      })
    }, [])

    const handlePickPath = useCallback(async () => {
      // Use a native save dialog via a simple IPC approach.
      // We reuse project.saveAs pattern — but we need a path only.
      // For now use a prompt as a placeholder (production would use dialog.showSaveDialog).
      const path = window.prompt('Export to path (e.g. /Users/you/output.mp3)')
      if (path) setOutputPath(path)
    }, [])

    const handleExport = useCallback(async () => {
      if (!outputPath) return
      setExportState({ status: 'exporting', progress: { percent: 0, currentSeconds: 0, totalSeconds: 0 } })
      try {
        // Patch the project's export format with the user's selection
        const exportProject: ProjectFile = { ...project, export: { ...project.export, format } }
        await window.electronAPI.render.export(exportProject, outputPath)
        setExportState({ status: 'done' })
      } catch (err) {
        setExportState({ status: 'error', message: (err as Error).message })
      }
    }, [outputPath, format, project])

    const isExporting = exportState.status === 'exporting'
    const pct = exportState.status === 'exporting'
      ? Math.round(exportState.progress.percent * 100)
      : exportState.status === 'done' ? 100 : 0

    return (
      <div
        style={{
          position:        'fixed',
          inset:           0,
          backgroundColor: 'rgba(0,0,0,0.6)',
          display:         'flex',
          alignItems:      'center',
          justifyContent:  'center',
          zIndex:          1000,
        }}
        onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      >
        <div
          style={{
            background:   'var(--color-bg-secondary)',
            border:       '1px solid var(--color-border)',
            borderRadius: 8,
            padding:      24,
            width:        360,
            display:      'flex',
            flexDirection:'column',
            gap:          16,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)' }}>Export Audio</h2>

          {/* Format */}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Format</span>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as 'mp3' | 'wav' | 'aac')}
              disabled={isExporting}
              style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', borderRadius: 4, color: 'var(--color-text-primary)', padding: '4px 8px', fontSize: 'var(--text-xs)' }}
            >
              <option value="mp3">MP3</option>
              <option value="wav">WAV</option>
              <option value="aac">AAC</option>
            </select>
          </label>

          {/* Output path */}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Output path</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                value={outputPath}
                onChange={(e) => setOutputPath(e.target.value)}
                placeholder="/Users/you/output.mp3"
                disabled={isExporting}
                style={{ flex: 1, background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', borderRadius: 4, color: 'var(--color-text-primary)', padding: '4px 8px', fontSize: 'var(--text-xs)' }}
              />
              <button onClick={handlePickPath} disabled={isExporting} style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', borderRadius: 4, color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', padding: '4px 8px', cursor: 'pointer' }}>
                Browse
              </button>
            </div>
          </label>

          {/* LUFS (display only) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
              Loudness target: {project.export?.targetLUFS ?? -16} LUFS
            </span>
            <span style={{ fontSize: 10, color: 'var(--color-text-muted)', opacity: 0.6 }}>(Phase 4)</span>
          </div>

          {/* Progress bar */}
          {(isExporting || exportState.status === 'done') && (
            <div>
              <div style={{ width: '100%', height: 4, background: 'var(--color-bg-elevated)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: 'var(--color-accent)', transition: 'width 0.3s ease' }} />
              </div>
              <span style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 4, display: 'block' }}>
                {exportState.status === 'done' ? 'Done!' : `${pct}%`}
              </span>
            </div>
          )}

          {/* Error */}
          {exportState.status === 'error' && (
            <p style={{ color: 'var(--color-danger)', fontSize: 'var(--text-xs)', margin: 0, wordBreak: 'break-all' }}>
              {exportState.message}
            </p>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button
              onClick={onClose}
              style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 4, color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', padding: '6px 14px', cursor: 'pointer' }}
            >
              {exportState.status === 'done' ? 'Close' : 'Cancel'}
            </button>
            <button
              onClick={handleExport}
              disabled={!outputPath || isExporting || exportState.status === 'done'}
              style={{ background: 'var(--color-accent)', border: 'none', borderRadius: 4, color: '#fff', fontSize: 'var(--text-xs)', padding: '6px 14px', cursor: 'pointer', opacity: (!outputPath || isExporting) ? 0.5 : 1 }}
            >
              {isExporting ? 'Exporting…' : 'Export'}
            </button>
          </div>
        </div>
      </div>
    )
  }
  ```

- [ ] **Step 2: Add export state + button to App.tsx**

  At the top of `App.tsx`, add the import:
  ```typescript
  import { ExportModal } from './components/Export/ExportModal'
  ```

  Inside `App()`, add state:
  ```typescript
  const [showExport, setShowExport] = useState(false)
  ```

  In the JSX title bar, after the "Save As…" button and before the closing `</div>` of the button group:
  ```typescript
  {openedFile && (
    <Button variant="ghost" size="sm" onClick={() => setShowExport(true)}>
      Export
    </Button>
  )}
  ```

  Just before the closing `</div>` of the root layout div, add:
  ```typescript
  {showExport && loadingState.status === 'ready' && (
    <ExportModal
      project={buildProject()!}
      onClose={() => setShowExport(false)}
    />
  )}
  ```

- [ ] **Step 3: Typecheck + build**

  ```bash
  npm run typecheck && npm run build
  ```
  Expected: build succeeds. Fix any residual type errors.

- [ ] **Step 4: Run all tests**

  ```bash
  npm test
  ```
  Expected: all tests PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/renderer/src/components/Export/ExportModal.tsx src/renderer/src/App.tsx
  git commit -m "feat(ui): add ExportModal with format selector, path picker, and progress bar"
  ```

---

## Final Verification

- [ ] **Run all tests**

  ```bash
  npm test
  ```
  Expected: all tests PASS.

- [ ] **Typecheck**

  ```bash
  npm run typecheck
  ```
  Expected: 0 errors.

- [ ] **Full build**

  ```bash
  npm run build
  ```
  Expected: 0 errors, output in `out/`.

- [ ] **Manual smoke test** (UI paths that cannot be unit-tested)

  Start the app with `npm run dev` and verify:
  - Open an audio file → single-track waveform renders, playback works, split/mute/undo still work
  - Click "+ Add Track" → file picker opens, second track appears with inline "Generating waveform…" then renders
  - Drag a clip block → ghost follows cursor, releases at new position, undo restores original
  - Generate transcript on primary track → words appear; track filter pills show in the header
  - Click a track filter pill → only words from that track are shown
  - Click "⚡ All tracks" → generates for each track without a transcript sequentially
  - Click "Export" → ExportModal opens; pick a path; progress bar advances to 100%

- [ ] **Mark DEVLOG entries done**

  In `DEVLOG.md`, mark the Phase 3 entries as resolved:
  - `[BUG] splitAt outputStart miscalculates` → add `2026-03-21: Fixed in Task 5`
  - `[MISSING] addSourceFile absent` → add `2026-03-21: Added in Task 5`

- [ ] **Commit final state**

  ```bash
  git add DEVLOG.md
  git commit -m "chore: mark Phase 3 DEVLOG items resolved"
  ```
