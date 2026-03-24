# Transcript Filter Redesign — Spec

**Date:** 2026-03-23
**Status:** Approved

## Problem

The current transcript panel uses a mutually-exclusive filter: "All" shows every track, clicking a track pill shows only that one. There is no way to view a subset (e.g. tracks 1 and 3 but not 2).

## Design

### Pills row — shown whenever `tracks.length > 0`

```
View: [● Track 1] [○ Track 2] [● Track 3]    [🤖 Generate ▾]
```

- Pills appear only for tracks that have a generated transcript (`words.some(w => w.trackId === track.id)`).
- Each pill is an independent toggle (multi-select). Clicking flips ON ↔ OFF.
- Color dot matches `track.color`. ON = colored background tint; OFF = dimmed.
- When a track's transcript is first generated, its pill appears **ON** automatically.
- Left side shows "No transcripts yet" label (italic, muted) when no tracks have transcripts yet.

### Generate button — right side of pills row

- Active when ≥ 1 track has no transcript yet.
- Inactive (greyed, no interaction) when every track has a transcript.
- Clicking opens a dropdown:
  - One item per **un-generated** track (tracks where `!words.some(w => w.trackId === t.id)`).
  - Divider, then `🤖 All tracks` (when nothing generated) or `🤖 All remaining` (when some exist).
- Clicking an item calls `onGenerate(trackId)` or `onGenerate()` for all remaining.

### Body — three states, evaluated in order

1. `isGenerating` → spinner (`GeneratingState`)
2. `!hasTranscript && tracks.length === 0` → "Add a track" empty variant (button disabled)
3. `!hasTranscript` → normal empty state (no generate button here — it's in the pills row)
4. otherwise → word list

The existing dead branch `tracks.length === 0 && !hasTranscript` after the `!hasTranscript` arm is removed.

### Merged view sort order

When multiple tracks are visible, words are interleaved by **output timeline position** — the time the word will be heard in the exported audio, not the source file timestamp.

Output time = `clip.outputStart + (word.start − clip.sourceStart)` for the clip covering that word. Falls back to `word.start` for legacy words with no `trackId`.

### Deletion routing (handleDeleteFromSelection)

After removing `activeTrackFilter`, the routing in `handleDeleteFromSelection` becomes entirely **word-driven**: the track and source file for `muteRange` are always derived from `selected[0]?.trackId` and the word's own `sourceFileId`. There is no longer a filter-derived routing path. This matches the existing fallback branch and is the correct behaviour for multi-select visibility.

---

## Data Model Changes

### `transcript.store.ts`

**Remove:** `activeTrackFilter: string | null`, `setActiveTrackFilter`

**Add:**
```typescript
// Stored as string[] (JSON-serializable). Exposed as Set via actions/selectors.
visibleTrackIds:      string[]
toggleTrackVisibility(trackId: string): void   // flip ON↔OFF; idempotent per call
ensureTrackVisible(trackId: string):   void   // called post-generation; adds if absent (idempotent)
```

`visibleWords` filter: convert `visibleTrackIds` to a `Set<string>` **once** (e.g. `useMemo`) before filtering — never call `.includes()` inside the per-word loop. Show word if `visibleSet.has(w.trackId)` OR `w.trackId` is undefined (legacy).

**Update `removeWordsForTrack`:** atomically removes `trackId` from both `words` and `visibleTrackIds` in the same `set()` call.

### New utility: `src/renderer/src/utils/wordOutputTime.ts`

```typescript
getWordOutputTime(word: Word, tracks: Track[]): number
// Returns output-timeline position for sorting. Falls back to word.start for legacy.
```

---

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/src/stores/transcript.store.ts` | Replace `activeTrackFilter` with `visibleTrackIds: string[]`, `toggleTrackVisibility`, `ensureTrackVisible`; update `removeWordsForTrack` |
| `src/renderer/src/utils/wordOutputTime.ts` | New — pure function for output time |
| `src/renderer/src/components/Transcript/TranscriptPanel.tsx` | New pills UX + generate dropdown; sort `visibleWords` by output time; word-driven deletion routing |
| `src/renderer/src/App.tsx` | After each track generates, call `ensureTrackVisible(trackId)` |

---

## Behaviour Matrix

| State | Pills row left side | Generate button |
|-------|---------------------|-----------------|
| No tracks | — (row hidden) | — |
| Tracks exist, nothing generated | "No transcripts yet" (muted italic) | Active: dropdown = all tracks + 🤖 All tracks |
| Some generated | Pills for generated tracks (ON by default) | Active: dropdown = un-generated tracks + 🤖 All remaining |
| All generated | Pills for all tracks | Inactive |

---

## Testing

1. Open file → pills row shows "No transcripts yet" + active generate button
2. Generate Track 1 → pill appears ON, generate dropdown shows Track 2 + "🤖 All remaining"
3. Toggle Track 1 pill OFF → words disappear; toggle ON → return
4. Generate all remaining → button goes inactive
5. Toggle Track 2 OFF, Track 3 OFF → only Track 1 words visible
6. Merged view (T1 + T3 ON): words interleaved in output-time order
7. Remove Track 2 → its pill disappears, its words removed, `visibleTrackIds` updated atomically
