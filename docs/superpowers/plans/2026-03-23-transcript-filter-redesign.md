# Transcript Filter Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-select "All / Track N" transcript filter with multi-select per-track visibility toggles, and move transcript generation into a always-visible Generate dropdown that shows only un-generated tracks.

**Architecture:** Three layers — (1) store replaces `activeTrackFilter: string | null` with `visibleTrackIds: string[]`; (2) a new pure utility `getWordOutputTime` enables output-timeline sorting; (3) `TranscriptPanel` gets a restructured pills row with toggle pills + generate dropdown.

**Tech Stack:** React, TypeScript, Zustand, Vitest

**Spec:** `docs/superpowers/specs/2026-03-23-transcript-filter-redesign.md`

---

## File Map

| File | What changes |
|------|-------------|
| `src/renderer/src/stores/transcript.store.ts` | Replace `activeTrackFilter`/`setActiveTrackFilter` with `visibleTrackIds: string[]`, `toggleTrackVisibility`, `ensureTrackVisible`; update `removeWordsForTrack` |
| `src/renderer/src/__tests__/transcript.store.test.ts` | **New** — unit tests for new store actions |
| `src/renderer/src/utils/wordOutputTime.ts` | **New** — pure function, no side-effects |
| `src/renderer/src/__tests__/wordOutputTime.test.ts` | **New** — unit tests |
| `src/renderer/src/components/Transcript/TranscriptPanel.tsx` | New pills row, generate dropdown, word-driven deletion routing, output-time sort |
| `src/renderer/src/App.tsx` | Call `ensureTrackVisible(tId)` per generated track |

---

## Task 1 — Store: replace `activeTrackFilter` with `visibleTrackIds`

**Files:**
- Modify: `src/renderer/src/stores/transcript.store.ts`
- Create: `src/renderer/src/__tests__/transcript.store.test.ts`

### What to change

**Remove from `TranscriptState` interface (lines 34–36):**
```typescript
activeTrackFilter: string | null
setActiveTrackFilter: (sourceFileId: string | null) => void
```

**Add to `TranscriptState` interface (after `showMutedWords`):**
```typescript
/**
 * IDs of tracks whose words are currently visible.
 * Stored as string[] for JSON-serializability.
 * Empty array = no tracks have transcripts yet (show nothing).
 */
visibleTrackIds: string[]

/** Flip a track's visibility ON↔OFF. Idempotent: adding an already-visible track is a no-op. */
toggleTrackVisibility: (trackId: string) => void

/**
 * Ensure a track is visible. Called after generation so the new transcript
 * appears immediately. Idempotent — safe to call even if already visible.
 */
ensureTrackVisible: (trackId: string) => void
```

**Remove from `initialState` (line 85):**
```typescript
activeTrackFilter: null as string | null,
```

**Add to `initialState`:**
```typescript
visibleTrackIds: [] as string[],
```

**Remove from the `create` body (line 120):**
```typescript
setActiveTrackFilter: (sourceFileId: string | null) => set({ activeTrackFilter: sourceFileId }),
```

**Add to the `create` body (after `toggleShowMutedWords`):**
```typescript
toggleTrackVisibility: (trackId) =>
  set((s) => ({
    visibleTrackIds: s.visibleTrackIds.includes(trackId)
      ? s.visibleTrackIds.filter((id) => id !== trackId)
      : [...s.visibleTrackIds, trackId],
  })),

ensureTrackVisible: (trackId) =>
  set((s) => ({
    visibleTrackIds: s.visibleTrackIds.includes(trackId)
      ? s.visibleTrackIds
      : [...s.visibleTrackIds, trackId],
  })),
```

**Update `removeWordsForTrack` (lines 134–138) — atomically remove from both `words` and `visibleTrackIds`:**
```typescript
removeWordsForTrack: (trackId) =>
  set((s) => ({
    words:           s.words.filter((w) => w.trackId !== trackId),
    visibleTrackIds: s.visibleTrackIds.filter((id) => id !== trackId),
  })),
```

### Store tests

Create `src/renderer/src/__tests__/transcript.store.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { useTranscriptStore } from '../stores/transcript.store'

beforeEach(() => useTranscriptStore.getState().reset())

describe('toggleTrackVisibility', () => {
  it('adds a track that is not yet visible', () => {
    useTranscriptStore.getState().toggleTrackVisibility('t1')
    expect(useTranscriptStore.getState().visibleTrackIds).toContain('t1')
  })

  it('removes a track that is already visible', () => {
    useTranscriptStore.getState().toggleTrackVisibility('t1')
    useTranscriptStore.getState().toggleTrackVisibility('t1')
    expect(useTranscriptStore.getState().visibleTrackIds).not.toContain('t1')
  })

  it('toggling twice returns to original empty state', () => {
    useTranscriptStore.getState().toggleTrackVisibility('t1')
    useTranscriptStore.getState().toggleTrackVisibility('t1')
    expect(useTranscriptStore.getState().visibleTrackIds).toHaveLength(0)
  })
})

describe('ensureTrackVisible', () => {
  it('adds track when absent', () => {
    useTranscriptStore.getState().ensureTrackVisible('t1')
    expect(useTranscriptStore.getState().visibleTrackIds).toContain('t1')
  })

  it('is idempotent — calling twice does not duplicate the id', () => {
    useTranscriptStore.getState().ensureTrackVisible('t1')
    useTranscriptStore.getState().ensureTrackVisible('t1')
    const ids = useTranscriptStore.getState().visibleTrackIds
    expect(ids.filter((id) => id === 't1')).toHaveLength(1)
  })
})

describe('removeWordsForTrack', () => {
  it('removes words belonging to the track', () => {
    useTranscriptStore.getState().setWords([
      { id: 'w1', text: 'a', start: 0, end: 1, muted: false, trackId: 't1' },
      { id: 'w2', text: 'b', start: 1, end: 2, muted: false, trackId: 't2' },
    ])
    useTranscriptStore.getState().removeWordsForTrack('t1')
    const words = useTranscriptStore.getState().words
    expect(words).toHaveLength(1)
    expect(words[0].id).toBe('w2')
  })

  it('removes the track id from visibleTrackIds atomically', () => {
    useTranscriptStore.getState().ensureTrackVisible('t1')
    useTranscriptStore.getState().ensureTrackVisible('t2')
    useTranscriptStore.getState().removeWordsForTrack('t1')
    const ids = useTranscriptStore.getState().visibleTrackIds
    expect(ids).not.toContain('t1')
    expect(ids).toContain('t2')
  })

  it('leaves other words untouched', () => {
    useTranscriptStore.getState().setWords([
      { id: 'w1', text: 'a', start: 0, end: 1, muted: false, trackId: 't1' },
      { id: 'w2', text: 'b', start: 1, end: 2, muted: false, trackId: 't2' },
    ])
    useTranscriptStore.getState().removeWordsForTrack('t1')
    expect(useTranscriptStore.getState().words[0].trackId).toBe('t2')
  })
})
```

### Steps

- [ ] **Step 1: Apply all store changes above**
- [ ] **Step 2: Create `transcript.store.test.ts` with tests above**
- [ ] **Step 3: Run store tests — expect all to pass**
  ```bash
  npm test -- --reporter=verbose src/renderer/src/__tests__/transcript.store.test.ts
  ```
- [ ] **Step 4: Search for all remaining `activeTrackFilter` / `setActiveTrackFilter` references**
  ```bash
  grep -rn "activeTrackFilter\|setActiveTrackFilter" src/
  ```
  Expected: only `TranscriptPanel.tsx` (handled in Task 3). Fix any unexpected occurrences now.
- [ ] **Step 5: Run build to catch TypeScript errors**
  ```bash
  npm run build 2>&1 | grep -E "error TS"
  ```
- [ ] **Step 6: Commit**
  ```
  refactor: replace activeTrackFilter with visibleTrackIds in transcript store

  Multi-select visibility replaces the old single-select filter.
  visibleTrackIds: string[] is JSON-serializable (no Set).
  removeWordsForTrack now atomically removes from both words and visibleTrackIds.
  ```

---

## Task 2 — New utility: `getWordOutputTime`

**Files:**
- Create: `src/renderer/src/utils/wordOutputTime.ts`
- Create: `src/renderer/src/__tests__/wordOutputTime.test.ts`

### Implementation

```typescript
// src/renderer/src/utils/wordOutputTime.ts
import type { Word, Track } from '@shared/project.types'

/**
 * Returns the output-timeline position (seconds) at which this word will be heard.
 *
 * Formula: clip.outputStart + (word.start − clip.sourceStart)
 *
 * Falls back to word.start for legacy words with no trackId (they are assumed
 * to be positioned at their source-file timestamp).
 */
export function getWordOutputTime(word: Word, tracks: Track[]): number {
  if (!word.trackId) return word.start   // legacy fallback

  const track = tracks.find((t) => t.id === word.trackId)
  if (!track) return word.start

  const clip = track.clips.find(
    (c) =>
      (!word.sourceFileId || c.sourceFileId === word.sourceFileId) &&
      c.sourceStart <= word.start &&
      word.start < c.sourceEnd,
  )
  if (!clip) return word.start

  return clip.outputStart + (word.start - clip.sourceStart)
}
```

### Tests

```typescript
// src/renderer/src/__tests__/wordOutputTime.test.ts
import { describe, it, expect } from 'vitest'
import { getWordOutputTime } from '../utils/wordOutputTime'
import type { Word, Track } from '@shared/project.types'

const mkWord = (overrides: Partial<Word> = {}): Word => ({
  id: 'w0', text: 'hello', start: 0, end: 0.5, muted: false,
  trackId: 'track1', sourceFileId: 'sf1',
  ...overrides,
})

const mkTrack = (clips: Track['clips']): Track => ({
  id: 'track1', name: 'Track 1', color: '#6366f1',
  muted: false, solo: false, volume: 1, clips,
})

const mkClip = (overrides: Partial<Track['clips'][0]> = {}): Track['clips'][0] => ({
  id: 'c1', trackId: 'track1', sourceFileId: 'sf1',
  sourceStart: 0, sourceEnd: 10, outputStart: 0, muted: false,
  ...overrides,
})

describe('getWordOutputTime', () => {
  it('returns source time for legacy words (no trackId)', () => {
    const word = mkWord({ trackId: undefined, start: 3 })
    expect(getWordOutputTime(word, [])).toBe(3)
  })

  it('returns source time when track not found', () => {
    const word = mkWord({ trackId: 'missing', start: 2 })
    expect(getWordOutputTime(word, [])).toBe(2)
  })

  it('returns source time when no clip covers word.start', () => {
    const track = mkTrack([mkClip({ sourceStart: 5, sourceEnd: 10 })])
    const word  = mkWord({ start: 3 })  // outside clip range
    expect(getWordOutputTime(word, [track])).toBe(3)
  })

  it('returns outputStart + offset when clip aligns with source', () => {
    // clip: source 0→10, output 0→10 (no repositioning)
    const track = mkTrack([mkClip({ sourceStart: 0, sourceEnd: 10, outputStart: 0 })])
    const word  = mkWord({ start: 4 })
    expect(getWordOutputTime(word, [track])).toBe(4)
  })

  it('applies outputStart offset when clip has been repositioned', () => {
    // clip moved: source 0→10 now plays at output 20→30
    const track = mkTrack([mkClip({ sourceStart: 0, sourceEnd: 10, outputStart: 20 })])
    const word  = mkWord({ start: 3 })
    expect(getWordOutputTime(word, [track])).toBe(23)  // 20 + (3 - 0)
  })

  it('handles non-zero sourceStart offset', () => {
    // clip: source 5→15, output 0→10 (first 5s of source trimmed)
    const track = mkTrack([mkClip({ sourceStart: 5, sourceEnd: 15, outputStart: 0 })])
    const word  = mkWord({ start: 7 })
    expect(getWordOutputTime(word, [track])).toBe(2)   // 0 + (7 - 5)
  })

  it('matches clip by sourceFileId when word has one', () => {
    const clipA = mkClip({ id: 'cA', sourceFileId: 'sf1', sourceStart: 0, sourceEnd: 5, outputStart: 0 })
    const clipB = mkClip({ id: 'cB', sourceFileId: 'sf2', sourceStart: 0, sourceEnd: 5, outputStart: 10 })
    const track = mkTrack([clipA, clipB])
    const word  = mkWord({ start: 2, sourceFileId: 'sf2' })
    expect(getWordOutputTime(word, [track])).toBe(12)  // 10 + (2 - 0)
  })
})
```

### Steps

- [ ] **Step 1: Create `wordOutputTime.ts` with implementation above**
- [ ] **Step 2: Create `wordOutputTime.test.ts` with tests above**
- [ ] **Step 3: Run tests — expect all to pass**
  ```bash
  npm test -- --reporter=verbose src/renderer/src/__tests__/wordOutputTime.test.ts
  ```
- [ ] **Step 4: Commit**
  ```
  feat: add getWordOutputTime utility for output-timeline word sorting

  Pure function: returns the output-timeline position of a word given
  the current clip layout. Falls back to word.start for legacy words.
  ```

---

## Task 3 — TranscriptPanel: new pills row + generate dropdown

**Files:**
- Modify: `src/renderer/src/components/Transcript/TranscriptPanel.tsx`

This task has four independent sub-changes. Apply them in order — each is a focused find-and-replace.

### Sub-change A: Update store subscriptions

**Replace lines 51–52:**
```typescript
const activeTrackFilter  = useTranscriptStore((s) => s.activeTrackFilter)
const setActiveTrackFilter = useTranscriptStore((s) => s.setActiveTrackFilter)
```

**With:**
```typescript
const visibleTrackIds        = useTranscriptStore((s) => s.visibleTrackIds)
const toggleTrackVisibility  = useTranscriptStore((s) => s.toggleTrackVisibility)
```

**Add below the `trackColorMap` memo (after line 70):**
```typescript
// Convert to Set once — O(1) lookups in the visibleWords filter
const visibleSet = useMemo(() => new Set(visibleTrackIds), [visibleTrackIds])

// Tracks that have at least one word (pill is shown for these)
const tracksWithTranscript = useMemo(
  () => tracks.filter((t) => words.some((w) => w.trackId === t.id)),
  [tracks, words],
)

// Tracks with no words yet — these appear in the Generate dropdown
const ungeneratedTracks = useMemo(
  () => tracks.filter((t) => !words.some((w) => w.trackId === t.id)),
  [tracks, words],
)

// True when all tracks are generated (generate button becomes inactive)
const allGenerated = ungeneratedTracks.length === 0

// Dropdown state at component level — NEVER inside an IIFE or conditional (Rules of Hooks)
const [dropdownOpen, setDropdownOpen] = React.useState(false)

// True when any words exist, regardless of visibility filter — guards empty-state copy
const hasAnyWords = words.length > 0
```

### Sub-change B: Update `visibleWords` and `handleDeleteFromSelection`

**Replace the `visibleWords` memo (lines 210–222):**
```typescript
const visibleWords = useMemo(() => words
  .filter((w) => !w.trackId || visibleSet.has(w.trackId))
  .filter((w) => {
    if (!showMutedWords) {
      if (w.muted) return false
      const cs = clipStateMap.get(w.id)
      if (cs === 'clip-muted' || cs === 'no-clip') return false
    }
    return true
  })
  .sort((a, b) => getWordOutputTime(a, tracks) - getWordOutputTime(b, tracks)),
[words, visibleSet, showMutedWords, clipStateMap, tracks])
```

**Update the word underline color guard** — find the line near line 382 that reads:
```typescript
const wordColor = !activeTrackFilter && word.trackId
```
or any conditional that uses `!activeTrackFilter` to decide whether to show colored underlines. Replace:
```typescript
!activeTrackFilter
```
with:
```typescript
visibleSet.size > 1
```
This ensures colored underlines only appear in merged-view (multiple tracks visible), matching the old "All" behavior.

**Add the import** at the top with the other utils (after line 30):
```typescript
import { getWordOutputTime } from '../../utils/wordOutputTime'
```

**Replace `handleDeleteFromSelection` routing block (lines 157–168) — remove `activeTrackFilter` dependency:**
```typescript
  // Route mute to the word's own track/source — always word-driven.
  const { sourceFiles: sfList, muteRange } = useTimelineStore.getState()
  const { tracks: tList } = useTimelineStore.getState()
  const routingTrack = selected[0]?.trackId
    ? tList.find((t) => t.id === selected[0].trackId)
    : null
  const sfId = routingTrack?.clips[0]?.sourceFileId
            ?? selected[0]?.sourceFileId
            ?? sfList[0]?.id
  if (sfId) muteRange(sfId, start, end, wordIds)
  sel.removeAllRanges()
  setSelection(null)
}, [words, setSelection])   // ← remove activeTrackFilter from deps
```

### Sub-change C: Replace pills row

**Replace lines 271–347 (the entire `{tracks.length > 1 && (...)}` pills block) with:**

```tsx
{/* ── Pills row — always shown when tracks exist ─────────────────────── */}
{/* allGenerated, dropdownOpen, setDropdownOpen are declared at component level in Sub-change A */}
{tracks.length > 0 && (
  <div
    style={{
      display:         'flex',
      alignItems:      'center',
      justifyContent:  'space-between',
      gap:             6,
      padding:         '4px var(--space-3)',
      borderBottom:    '1px solid var(--color-border)',
      flexShrink:      0,
      flexWrap:        'wrap',
      position:        'relative',
    }}
  >
      {/* Left: visibility pills OR placeholder */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', minHeight: 22 }}>
        {tracksWithTranscript.length === 0 ? (
          <span style={{ fontSize: 10, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
            No transcripts yet
          </span>
        ) : (
          tracksWithTranscript.map((track) => {
            const isOn = visibleSet.has(track.id)
            return (
              <button
                key={track.id}
                onClick={() => toggleTrackVisibility(track.id)}
                style={{
                  display:         'inline-flex',
                  alignItems:      'center',
                  gap:             4,
                  background:      isOn
                    ? `${track.color}28`
                    : 'var(--color-bg-elevated)',
                  border:          `1px solid ${isOn ? track.color + '88' : 'var(--color-border)'}`,
                  borderRadius:    10,
                  color:           isOn ? track.color : 'var(--color-text-muted)',
                  fontSize:        10,
                  padding:         '2px 8px',
                  cursor:          'pointer',
                  letterSpacing:   '0.03em',
                }}
              >
                <span
                  style={{
                    width:           5,
                    height:          5,
                    borderRadius:    '50%',
                    backgroundColor: isOn ? track.color : 'var(--color-text-muted)',
                    flexShrink:      0,
                  }}
                />
                {track.name}
              </button>
            )
          })
        )}
      </div>

      {/* Right: Generate dropdown button */}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <button
          disabled={allGenerated}
          onClick={() => !allGenerated && setDropdownOpen((o) => !o)}
          style={{
            display:       'inline-flex',
            alignItems:    'center',
            gap:           4,
            padding:       '2px 8px',
            borderRadius:  4,
            fontSize:      10,
            border:        `1px solid ${allGenerated ? 'var(--color-border)' : 'rgba(99,102,241,0.45)'}`,
            background:    allGenerated ? 'var(--color-bg-elevated)' : 'rgba(99,102,241,0.12)',
            color:         allGenerated ? 'var(--color-text-muted)' : '#a5b4fc',
            cursor:        allGenerated ? 'not-allowed' : 'pointer',
            opacity:       allGenerated ? 0.5 : 1,
          }}
        >
          🤖 Generate ▾
        </button>

        {dropdownOpen && !allGenerated && (
          <>
            {/* Click-away backdrop */}
            <div
              style={{ position: 'fixed', inset: 0, zIndex: 40 }}
              onClick={() => setDropdownOpen(false)}
            />
            <div
              style={{
                position:    'absolute',
                right:       0,
                top:         '100%',
                marginTop:   3,
                background:  'var(--color-bg-elevated)',
                border:      '1px solid var(--color-border)',
                borderRadius: 5,
                padding:     '3px 0',
                zIndex:      50,
                minWidth:    140,
                boxShadow:   '0 4px 12px rgba(0,0,0,0.35)',
              }}
            >
              {ungeneratedTracks.map((track) => (
                <button
                  key={track.id}
                  onClick={() => { setDropdownOpen(false); onGenerate(track.id) }}
                  style={{
                    display:    'flex',
                    alignItems: 'center',
                    gap:        6,
                    width:      '100%',
                    padding:    '4px 10px',
                    background: 'none',
                    border:     'none',
                    color:      'var(--color-text-secondary)',
                    fontSize:   10,
                    cursor:     'pointer',
                    textAlign:  'left',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(99,102,241,0.1)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                >
                  <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: track.color, flexShrink: 0 }} />
                  {track.name}
                </button>
              ))}
              <div style={{ borderTop: '1px solid var(--color-border)', margin: '2px 0' }} />
              <button
                onClick={() => { setDropdownOpen(false); onGenerate() }}
                style={{
                  display:    'block',
                  width:      '100%',
                  padding:    '4px 10px',
                  background: 'none',
                  border:     'none',
                  color:      '#a5b4fc',
                  fontSize:   10,
                  cursor:     'pointer',
                  textAlign:  'left',
                  fontWeight: 500,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(99,102,241,0.1)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
              >
                🤖 {tracksWithTranscript.length === 0 ? 'All tracks' : 'All remaining'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
)}
```

> **Critical:** `dropdownOpen`/`setDropdownOpen` and `allGenerated` are declared at the component level in Sub-change A — they must NOT be inside an IIFE or conditional block. React's Rules of Hooks forbid calling `useState` inside loops, conditions, or nested functions.

### Sub-change D: Fix body states — remove dead branch, simplify empty state

**Replace lines 350–356:**
```tsx
{isGenerating ? (
  <GeneratingState status={generatingStatus} />
) : !hasTranscript ? (
  <EmptyTranscriptState onGenerate={onGenerate} activeTrackId={activeTrackFilter} />
) : tracks.length === 0 && !hasTranscript ? (
  <EmptyTranscriptState onGenerate={onGenerate} activeTrackId={null} disabled />
) : (
```

**With:**
```tsx
{isGenerating ? (
  <GeneratingState status={generatingStatus} />
) : !hasAnyWords && tracks.length === 0 ? (
  <EmptyTranscriptState noTracks />
) : !hasAnyWords ? (
  <EmptyTranscriptState />
) : (
```

Two cases are distinguished:
- `tracks.length === 0`: no tracks exist — pills row is hidden, so there is no Generate button visible. Show "Add a track" messaging.
- `tracks.length > 0 && !hasAnyWords`: tracks exist but none have been transcribed — pills row IS visible with the Generate button. Show "Use 🤖 Generate above".

`hasAnyWords` (declared in Sub-change A) is `words.length > 0`, independent of the visibility filter. This prevents the empty state from appearing when all track pills are toggled off — that state is not "no transcript", it's "user hid everything".

**Replace the `EmptyTranscriptState` function** — it takes an optional `noTracks` prop to distinguish the two cases:
```tsx
function EmptyTranscriptState({ noTracks = false }: { noTracks?: boolean }) {
  return (
    <div
      style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 'var(--space-3)', padding: 'var(--space-4)', textAlign: 'center',
      }}
    >
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
        stroke="var(--color-text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="23" />
        <line x1="8" y1="23" x2="16" y2="23" />
      </svg>
      <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>
        No transcript yet
      </p>
      <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', maxWidth: 180 }}>
        {noTracks
          ? 'Add a track to get started'
          : 'Use 🤖 Generate above to transcribe a track'}
      </p>
    </div>
  )
}
```

Also remove `onGenerate` and `activeTrackId` from the `EmptyTranscriptState` call sites in `TranscriptPanel.tsx` (the two call sites that became `<EmptyTranscriptState />` / `<EmptyTranscriptState noTracks />` in the diff above — these are already replaced by the Sub-change D diff, no separate action needed).

**Remove the `hasTranscript` variable declaration.** The old component had:
```typescript
const hasTranscript = visibleWords.length > 0
```
or similar. After Sub-change D replaces all usages with `hasAnyWords`, this declaration is dead code — delete it. Run a quick grep to locate it:
```bash
grep -n "hasTranscript" src/renderer/src/components/Transcript/TranscriptPanel.tsx
```
Then delete the declaration line.

### Steps

- [ ] **Step 1: Apply Sub-change A** (store subscriptions + computed values)
- [ ] **Step 2: Apply Sub-change B** (visibleWords + handleDeleteFromSelection + import)
- [ ] **Step 3: Apply Sub-change C** (pills row replacement)
- [ ] **Step 4: Apply Sub-change D** (body states + EmptyTranscriptState)
- [ ] **Step 5: Run build**
  ```bash
  npm run build 2>&1 | grep -E "error TS"
  ```
- [ ] **Step 6: Run tests**
  ```bash
  npm test
  ```
- [ ] **Step 7: Commit**
  ```
  feat: multi-select transcript visibility pills + generate dropdown

  - Track pills are now independent toggles (multi-select); pills only
    appear for tracks with a generated transcript
  - Newly generated tracks are auto-enabled (ensureTrackVisible)
  - Generate button (🤖) moves to pills row with dropdown listing
    only un-generated tracks; inactive once all are generated
  - "All remaining" vs "All tracks" label based on prior generation state
  - visibleWords sorted by output-timeline position (getWordOutputTime)
  - handleDeleteFromSelection routing is now always word-driven
  - EmptyTranscriptState simplified — no duplicate generate button
  ```

---

## Task 4 — App.tsx: call `ensureTrackVisible` after generation

**Files:**
- Modify: `src/renderer/src/App.tsx`

### What to change

After the `setWords(currentWords)` call in `handleGenerateTranscript` (line 488), call `ensureTrackVisible` for each track that was just generated:

```typescript
      setWords(currentWords)
      // Auto-enable visibility for each newly generated track
      const { ensureTrackVisible } = useTranscriptStore.getState()
      for (const tId of taggedByTrack.keys()) {
        ensureTrackVisible(tId)
      }
      setIsDirty(true)
```

### Steps

- [ ] **Step 1: Apply the change above**
- [ ] **Step 2: Run build**
  ```bash
  npm run build 2>&1 | grep -E "error TS"
  ```
- [ ] **Step 3: Run tests**
  ```bash
  npm test
  ```
- [ ] **Step 4: Commit**
  ```
  feat: auto-enable transcript visibility after generation

  ensureTrackVisible(trackId) is called for each track whose transcript
  is newly generated, so the pill appears ON immediately.
  ```

---

## Verification

After all tasks complete:

```bash
npm test && npm run build
```

Manual smoke test:
1. Open an audio file → pills row shows "No transcripts yet" (left) + active 🤖 Generate button (right)
2. Click 🤖 Generate → dropdown shows track name(s) + "🤖 All tracks"
3. Generate Track 1 → pill for Track 1 appears **ON** automatically; dropdown now shows remaining tracks + "🤖 All remaining"
4. Generate remaining → Generate button goes inactive (greyed)
5. Toggle Track 1 pill OFF → Track 1 words disappear from view; toggle ON → return
6. With Track 1 ON and Track 2 ON: merged view shows words sorted by output-time position
7. Move a clip (split + drag) → merged sort re-orders correctly in transcript
8. Delete Track 2 → its pill disappears, its words removed, Generate button stays inactive (Track 2 was generated, track is gone)
9. Add new Track 3 → Generate button becomes active again with Track 3 in dropdown
