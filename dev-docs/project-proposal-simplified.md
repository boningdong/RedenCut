# PodCut — A Podcast Audio Editor

*Product Overview — March 2026*

---

## Why We're Building This

Existing tools don't fit the way podcasters actually work. Audacity and Reaper are powerful but overcomplicated — built for music production, not spoken-word editing. Descript gets the concept right (edit audio like a document) but locks you into a monthly subscription with no way out.

PodCut is built around a simple idea: **edit your podcast by editing text, not by wrestling with a waveform.** It's a focused tool that does one job well, stays fast, and puts you in control of your files.

---

## Core Features

### 1. Automatic Transcription

Import your audio file and PodCut generates a full transcript — every word, timestamped, with each speaker clearly labeled. You'll see "Host" and "Guest" (or whatever labels you choose) alongside their words throughout the episode.

This works with a cloud transcription service for the best accuracy, with an option to run it fully offline if you prefer to keep your audio local.

### 2. Edit by Reading, Not Listening

The main editing surface is the transcript, not the waveform. To remove something — a tangent, a stumble, an awkward pause — you just select the words in the text and mute them. The audio is never deleted or altered; it's simply marked to be skipped on playback and export.

This means you can edit a one-hour episode by skimming through text in minutes, rather than scrubbing back and forth through audio.

### 3. Waveform View for Fine-Tuning

Alongside the transcript, a waveform display gives you a visual reference of the audio. Muted sections appear dimmed in the waveform so you can see exactly what's been cut at a glance.

For fine adjustments — trimming a few extra milliseconds at the start or end of a cut — you can drag the edges of a muted region directly in the waveform.

### 4. Synchronized Playback

During playback, the current word is highlighted in the transcript as the audio plays — like karaoke. Click any word in the transcript to jump the playhead to that moment. Select a passage of text and the waveform zooms to that region. Everything stays in sync.

Playback skips muted regions automatically. You hear the edited version as you work, without having to export first.

### 5. Smooth Transitions

When a section is muted, PodCut automatically applies a short crossfade at the cut points so the audio flows naturally rather than jumping. You can adjust the crossfade length per cut, or leave it at the default.

### 6. Per-Section Volume Control

If a guest was sitting further from the mic, or one section came in too hot, you can adjust the volume for any segment independently. These adjustments are non-destructive — the original recording is never touched.

### 7. Automatic Filler Word Detection

PodCut scans the transcript for common filler words — "um," "uh," "like," "you know," and others — and flags them for review. You can preview the list and mute them all in one click, or go through them individually.

### 8. Jump Cut Detection

After making edits, PodCut analyzes the audio around each cut point and flags any transitions that might sound abrupt or unnatural. You can review flagged cuts and choose to add a crossfade, extend the mute slightly, or leave it as-is.

### 9. Safe, Non-Destructive Editing

Your original audio file is never modified. All edits are stored in a separate project file that records your decisions — what's muted, what's adjusted, where markers are. You can undo any edit, revert to the original, or re-edit from scratch at any time without reimporting the audio.

### 10. One-Click Export

When you're ready, PodCut renders the final audio file — applying all your edits, adjustments, and crossfades, and normalizing the loudness to the standard level used by Apple Podcasts and Spotify. You get a clean, publish-ready MP3.

---

## What's Not in PodCut

PodCut is deliberately focused. It doesn't do multi-track mixing, real-time recording, noise reduction, EQ, or video editing. For those, use dedicated tools before or after. PodCut's job is to take a recorded episode and turn it into a clean, edited one — nothing more.

---

## Development Phases

**Phase 1 — Working Pipeline (Weeks 1–3)**
Transcription and export work end-to-end from the command line. The workflow is functional, even if the interface isn't pretty yet. Real episodes can be edited to validate the approach.

**Phase 2 — Text Editor UI (Weeks 4–6)**
The core editing interface: transcript view, word selection, mute, waveform display, synchronized playback. This is the product.

**Phase 3 — Fine Editing (Weeks 7–9)**
Draggable cut boundaries, per-region volume, crossfade controls, keyboard shortcuts, and project save/load.

**Phase 4 — AI Assists (Weeks 10–11)**
Filler word detection UI and jump-cut detection with suggested fixes.

**Phase 5 — Polish (Week 12)**
Dark mode, packaging as a macOS app, and documentation.

At a comfortable pace, Phases 1 and 2 — a fully usable tool — take about six weeks. The complete build takes around ten.
