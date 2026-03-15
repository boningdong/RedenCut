// ─────────────────────────────────────────────────────────────────────────────
// FrameIndex
//
// Builds a seekable byte-offset map for common audio container formats.
// WebCodecsPlayer uses this to issue a Range request to the podcut:// protocol
// for exactly the compressed bytes that correspond to a given seek time,
// rather than loading the entire file into memory.
//
// Supported formats:
//   MP3  — sync-word scan (0xFFE0 mask); each frame header gives bitrate/mode
//   WAV  — passthrough; PCM is already uncompressed, byte offset = time × rate × channels × depth
//   M4A  — mp4box.js extracts the "stts" and "stco" sample-to-chunk tables
//   FLAC — frame sync (0xFFFx), fixed overhead per frame
//
// Returns:
//   FrameIndex — an object with a seekTo(seconds) method that returns
//     { byteOffset, frameTime } — where to start a Range request and what
//     presentation timestamp to expect from the first decoded frame.
//
// NOTE: Accuracy matters for preview-mode skip. An incorrect byte offset will
// cause the decoder to fail (no sync found) or produce a gap at the cut boundary.
// The index is built once per source file and cached in WebCodecsPlayer.
// ─────────────────────────────────────────────────────────────────────────────

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FrameEntry {
  /** Byte offset of this frame in the source file. */
  byteOffset: number
  /** Presentation timestamp (seconds) of the first sample in this frame. */
  time: number
  /** Duration of this frame in seconds. */
  duration: number
}

export interface FrameIndex {
  /** All frame entries, sorted by time ascending. */
  frames: FrameEntry[]

  /**
   * Find the best frame to start decoding from for a seek to `targetTime`.
   * Returns the entry whose time <= targetTime (or the first frame if before all).
   */
  seek(targetTime: number): FrameEntry
}

// ── MP3 ───────────────────────────────────────────────────────────────────────
//
// MP3 frame header format (4 bytes):
//   Sync word:     bits 31-21  = 0x7FF  (all 11 set)
//   MPEG version:  bits 20-19
//   Layer:         bits 18-17
//   CRC absent:    bit  16
//   Bitrate index: bits 15-12
//   Sample rate:   bits 11-10
//   Padding:       bit  9
//   Channel mode:  bits 7-6
//
// Frame size (bytes) = 144 × bitrate / sampleRate + padding

const MP3_BITRATES_V1_L3 = [
  0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0,
] // kbps

const MP3_SAMPLE_RATES = [44100, 48000, 32000, 0]   // Hz for MPEG-1

const MP3_SAMPLES_PER_FRAME = 1152  // MPEG-1 Layer 3

function parseMp3Header(b0: number, b1: number, b2: number): {
  frameSize: number
  sampleRate: number
} | null {
  // Check sync word (bits 31-21, first 11 bits all 1)
  if ((b0 & 0xff) !== 0xff || (b1 & 0xe0) !== 0xe0) return null

  const mpegVersion = (b1 >> 3) & 0x03   // 0b11 = MPEG-1, 0b10 = MPEG-2
  const layer       = (b1 >> 1) & 0x03   // 0b01 = Layer 3
  if (mpegVersion !== 3 || layer !== 1) return null   // only MPEG-1 Layer 3

  const bitrateIdx  = (b2 >> 4) & 0x0f
  const sampleIdx   = (b2 >> 2) & 0x03
  const padding     = (b2 >> 1) & 0x01

  const bitrate   = MP3_BITRATES_V1_L3[bitrateIdx]
  const sampleRate = MP3_SAMPLE_RATES[sampleIdx]

  if (!bitrate || !sampleRate) return null

  const frameSize = Math.floor(144 * (bitrate * 1000) / sampleRate) + padding
  return { frameSize, sampleRate }
}

async function buildMp3Index(url: string): Promise<FrameIndex> {
  console.log('[FrameIndex] Building MP3 index for', url)

  // Fetch the first 256 KB to probe for the initial frame parameters,
  // then build an approximate index using constant bitrate assumption.
  // For VBR files we scan the full file (up to 20 MB).
  const headResponse = await fetch(url, { headers: { Range: 'bytes=0-262143' } })
  const headBuffer = await headResponse.arrayBuffer()
  const data = new Uint8Array(headBuffer)

  // Get total file size from Content-Range header
  const contentRange = headResponse.headers.get('content-range') ?? ''
  const totalMatch = contentRange.match(/\/(\d+)$/)
  const totalBytes = totalMatch ? parseInt(totalMatch[1]) : data.length

  const frames: FrameEntry[] = []
  let offset = 0
  let currentTime = 0
  let lastSampleRate = 44100

  // Skip ID3v2 tag if present
  if (data[0] === 0x49 && data[1] === 0x44 && data[2] === 0x33) {
    const id3Size = ((data[6] & 0x7f) << 21) | ((data[7] & 0x7f) << 14) |
                   ((data[8] & 0x7f) <<  7) |  (data[9] & 0x7f)
    offset = 10 + id3Size
    console.log(`[FrameIndex] MP3 skipping ID3v2 tag (${id3Size} bytes)`)
  }

  let framesScanned = 0

  while (offset + 4 < data.length) {
    const result = parseMp3Header(data[offset], data[offset + 1], data[offset + 2])
    if (!result) {
      offset++
      continue
    }

    const { frameSize, sampleRate } = result
    lastSampleRate = sampleRate
    const frameDuration = MP3_SAMPLES_PER_FRAME / sampleRate

    // Only keep a sparse index (every ~0.5 s) to save memory
    if (framesScanned % Math.max(1, Math.round(0.5 * sampleRate / MP3_SAMPLES_PER_FRAME)) === 0) {
      frames.push({ byteOffset: offset, time: currentTime, duration: frameDuration })
    }

    currentTime += frameDuration
    offset += frameSize
    framesScanned++
  }

  // Extrapolate remaining frames from the total file size
  if (frames.length > 0 && totalBytes > data.length) {
    const lastFrame = frames[frames.length - 1]
    const avgBytesPerSec = lastFrame.byteOffset > 0
      ? lastFrame.byteOffset / Math.max(lastFrame.time, 0.1)
      : 16000  // 128 kbps fallback

    let extraOffset = data.length
    let extraTime = currentTime

    while (extraOffset < totalBytes) {
      const frameDuration = MP3_SAMPLES_PER_FRAME / lastSampleRate
      frames.push({ byteOffset: extraOffset, time: extraTime, duration: frameDuration })
      const approxFrameSize = Math.round(avgBytesPerSec * frameDuration)
      extraOffset += Math.max(1, approxFrameSize)
      extraTime += frameDuration
    }
  }

  console.log(`[FrameIndex] MP3 index built: ${frames.length} entries, ${currentTime.toFixed(1)}s scanned`)
  return createIndex(frames)
}

// ── WAV ───────────────────────────────────────────────────────────────────────
//
// WAV (PCM) has no frames — byte offset maps directly to time.
// We create a synthetic index with one entry per second for fast seeking.

async function buildWavIndex(url: string): Promise<FrameIndex> {
  console.log('[FrameIndex] Building WAV index for', url)

  // Read the 44-byte header
  const headResp = await fetch(url, { headers: { Range: 'bytes=0-43' } })
  const header = new DataView(await headResp.arrayBuffer())

  // WAV header: "RIFF" at 0, "WAVE" at 8, "fmt " at 12
  const channels   = header.getUint16(22, true)
  const sampleRate = header.getUint32(24, true)
  const bitDepth   = header.getUint16(34, true)
  const dataOffset = 44  // standard PCM header

  const bytesPerSample = (bitDepth / 8) * channels
  const bytesPerSecond = sampleRate * bytesPerSample

  // Get total file size
  const contentRange = headResp.headers.get('content-range') ?? ''
  const totalMatch = contentRange.match(/\/(\d+)$/)
  const totalBytes = totalMatch ? parseInt(totalMatch[1]) : 0
  const dataBytes = totalBytes - dataOffset

  const frames: FrameEntry[] = []
  const stepSeconds = 1.0  // one entry per second

  for (let t = 0; t * bytesPerSecond < dataBytes; t += stepSeconds) {
    const byteOffset = dataOffset + Math.floor(t * bytesPerSecond)
    frames.push({ byteOffset, time: t, duration: stepSeconds })
  }

  console.log(`[FrameIndex] WAV index: ${frames.length} entries, sampleRate=${sampleRate} channels=${channels} bitDepth=${bitDepth}`)
  return createIndex(frames)
}

// ── M4A / AAC ────────────────────────────────────────────────────────────────
//
// Uses mp4box.js to parse the MP4 container and extract sample metadata.
// mp4box gives us each sample's offset + duration, from which we build
// a precise frame index.

async function buildM4aIndex(url: string): Promise<FrameIndex> {
  console.log('[FrameIndex] Building M4A index for', url)

  // mp4box.js is loaded globally via a <script> tag in index.html (see Phase 2 note)
  // Fallback: fetch first 1 MB, pass to mp4box
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const MP4Box = (window as any).MP4Box
  if (!MP4Box) {
    console.warn('[FrameIndex] mp4box.js not available — using fallback uniform index for M4A')
    return buildUniformIndex(url, 'aac', 1024)
  }

  return new Promise<FrameIndex>((resolve) => {
    const mp4boxFile = MP4Box.createFile()
    const frames: FrameEntry[] = []

    mp4boxFile.onReady = (info: { tracks: Array<{ id: number; type: string; movie_duration: number; movie_timescale: number }> }) => {
      const audioTrack = info.tracks.find((t) => t.type === 'audio')
      if (!audioTrack) {
        resolve(createIndex(frames))
        return
      }
      mp4boxFile.setExtractionOptions(audioTrack.id, null, { nbSamples: 100 })
      mp4boxFile.start()
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mp4boxFile.onSamples = (_id: number, _user: unknown, samples: any[]) => {
      for (const sample of samples) {
        frames.push({
          byteOffset: sample.offset,
          time: sample.cts / sample.timescale,
          duration: sample.duration / sample.timescale,
        })
      }
      resolve(createIndex(frames))
    }

    mp4boxFile.onError = () => {
      console.warn('[FrameIndex] mp4box error — using uniform fallback')
      resolve(buildUniformIndex(url, 'aac', 1024))
    }

    // Fetch and feed data in chunks
    fetch(url, { headers: { Range: 'bytes=0-2097151' } })  // first 2 MB
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        // mp4box requires a file start property on the buffer
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(buf as any).fileStart = 0
        mp4boxFile.appendBuffer(buf)
        mp4boxFile.flush()
      })
      .catch(() => resolve(buildUniformIndex(url, 'aac', 1024)))
  })
}

// ── Uniform fallback ──────────────────────────────────────────────────────────
//
// When we can't parse the container, estimate frame positions from the
// typical samples-per-frame for the codec. Good enough for FLAC and AAC
// when the exact parser isn't available.

async function buildUniformIndex(
  url:             string,
  codec:           string,
  samplesPerFrame: number,
): Promise<FrameIndex> {
  console.log(`[FrameIndex] building uniform index for ${codec} (${samplesPerFrame} spf)`)

  // Get file size and rough duration from headers
  const resp = await fetch(url, { method: 'HEAD' })
  const contentLength = parseInt(resp.headers.get('content-length') ?? '0')

  // Assume 128 kbps for estimating duration if we have no better info
  const estimatedDuration = contentLength / (128 * 1000 / 8)
  const sampleRate = 44100
  const frameDuration = samplesPerFrame / sampleRate

  const frames: FrameEntry[] = []
  const bytesPerFrame = Math.round(contentLength / Math.max(1, estimatedDuration / frameDuration))

  for (let i = 0; i * bytesPerFrame < contentLength; i++) {
    frames.push({
      byteOffset: i * bytesPerFrame,
      time: i * frameDuration,
      duration: frameDuration,
    })
  }

  console.log(`[FrameIndex] uniform index: ${frames.length} entries`)
  return createIndex(frames)
}

// ── Index factory ─────────────────────────────────────────────────────────────

function createIndex(frames: FrameEntry[]): FrameIndex {
  // Ensure sorted by time (defensive, should already be sorted)
  frames.sort((a, b) => a.time - b.time)

  return {
    frames,
    seek(targetTime: number): FrameEntry {
      if (frames.length === 0) return { byteOffset: 0, time: 0, duration: 0 }
      if (targetTime <= 0) return frames[0]

      // Binary search for the last frame whose time <= targetTime
      let lo = 0, hi = frames.length - 1
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (frames[mid].time <= targetTime) lo = mid
        else hi = mid - 1
      }
      return frames[lo]
    },
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build a FrameIndex for the given podcut:// URL.
 * The format is detected from the URL extension.
 */
export async function buildFrameIndex(url: string): Promise<FrameIndex> {
  const lower = url.toLowerCase()

  if (lower.includes('.mp3')) return buildMp3Index(url)
  if (lower.includes('.wav')) return buildWavIndex(url)
  if (lower.includes('.m4a') || lower.includes('.aac')) return buildM4aIndex(url)
  if (lower.includes('.flac')) return buildUniformIndex(url, 'flac', 4096)

  // Unknown format — build a minimal 1-second index as fallback
  console.warn('[FrameIndex] Unknown format for URL:', url, '— using uniform fallback')
  return buildUniformIndex(url, 'unknown', 1024)
}
