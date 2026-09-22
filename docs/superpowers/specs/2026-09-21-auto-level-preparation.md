# Auto Level and shared preparation

## Approved intent
Balance alternating quiet/loud voices in a logical track, including routed Replace audio, without forcing -16 LUFS. Preserve originals, natural syllabic dynamics, manual Gain and Volume. Share identical preparation between playback and waveform, index final PCM while writing it, and show measured phase progress while retaining the last waveform. User approved all four changes and previously waived document review.

## Processing
Compose dry PCM using the existing sample-domain render plan. Analyze linked-channel 100 ms RMS windows during decode, retain bounded window statistics rather than PCM in memory. Use gated median active-speech-window dB as reference, bounded smooth gain (maximum ±12 dB, 85% correction), and conservative sample peak ceiling. Silence/low-level background must not receive positive gain. This is amplitude-based gating, not semantic speaker/music classification. All Replace sources share their composed master reference. Independent unlinked tracks retain independent references; project-wide matching is not inferred from arbitrary music/voice tracks.
During the final PCM pass apply the envelope and accumulate min/max waveform buckets concurrently. Do not reread full processed PCM to build overview. Exact deep zoom may read only the requested range. For tracks without Auto Level, decode directly to final PCM and waveform index. Preserve length, linked-channel balance and source files.

## Sharing and ownership
Key by effective rendered composition, effect algorithm revision, source fingerprint/channel layout and duration. Gain/Volume and display metadata do not change prepared PCM. Different mode labels may share only when their effective samples/timing agree. Reference-count workspace/sender-scoped jobs. Releasing one consumer never cancels another. Cancel unobserved running jobs, retain bounded idle results, dispose all jobs on workspace/window teardown.

## Progress
Use actual frames processed, not timers. Processing phase covers dry decoding/analysis; waveform phase covers leveled PCM writing/indexing. Completion publishes the new provider atomically; previous provider survives edits until replacement is ready. Progress IPC never grants access to another lease's handle.

## Export
Encode the same prepared Auto Level PCM used by preview, applying track Gain/Volume once afterwards. Raw-only exports preserve the existing fast path. Prepared export jobs must be cancelled/disposed on cancel/failure. No hardwired LUFS mastering step remains.

## Acceptance
PCM measurements: quiet uniform voice stays near unity; alternating voices converge; gate avoids low-level noise lift; finite stereo samples, exact frame count, sample peak ceiling and export parity. Cache tests: simultaneous playback/waveform one render, independent release, stale revision/project close, key differences and bounded eviction. Streaming tests: arbitrary byte splits, cancellation, no second overview scan. UI: phases/real percentage, old waveform retained, successful/cancelled transitions, 3/4/6-source routing, English/Chinese copy. Full engineering checks and fresh Docker baseline plus targeted UI acceptance required.
