# Prepared audio fixtures

`mandarin-short-female.wav` is the existing short Mandarin speech fixture.
`mandarin-short-female.m4a` is an AAC encoding of that same recording for compressed-input import and second-track transcription checks; it is not an independent voice sample.
Both files are directly selectable by filename through the harness prepared import dialog.
The dialog accepts regular files directly inside this directory, without requiring a codec-specific allowlist or harness changes.

The M4A fixture was generated with the available FFmpeg executable:

```sh
ffmpeg -hide_banner -loglevel error -n -i e2e/fixtures/audio/mandarin-short-female.wav -map 0:a:0 -c:a aac -b:a 128k -movflags +faststart e2e/fixtures/audio/mandarin-short-female.m4a
```

Observed FFprobe properties: AAC, 48 kHz, mono, 13.500 seconds, 226422 bytes.
Encoder versions may produce different bytes; the committed fixture is the stable test input.
Do not regenerate fixtures inside an active acceptance container or mutate these inputs during source freeze.
Save projects, imported caches and generated transcription results in owned run directories.

Conversation fixtures and their provenance are documented in [conversation/README.md](conversation/README.md).

`mandarin-conversation-mix.wav` is a repository-local symlink to the immutable conversation mix under `conversation/`, exposing it to the basename-only prepared import dialog without duplicating audio.
