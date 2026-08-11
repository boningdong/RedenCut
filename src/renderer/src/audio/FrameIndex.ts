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
//   M4A  — uniform AAC frame estimate (1024 samples per frame)
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

const MP3_BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0] // kbps

const MP3_SAMPLE_RATES = [44100, 48000, 32000, 0] // Hz for MPEG-1

const MP3_SAMPLES_PER_FRAME = 1152 // MPEG-1 Layer 3

function parseMp3Header(
  b0: number,
  b1: number,
  b2: number,
): {
  frameSize: number
  sampleRate: number
} | null {
  // Check sync word (bits 31-21, first 11 bits all 1)
  if ((b0 & 0xff) !== 0xff || (b1 & 0xe0) !== 0xe0) return null

  const mpegVersion = (b1 >> 3) & 0x03 // 0b11 = MPEG-1, 0b10 = MPEG-2
  const layer = (b1 >> 1) & 0x03 // 0b01 = Layer 3
  if (mpegVersion !== 3 || layer !== 1) return null // only MPEG-1 Layer 3

  const bitrateIdx = (b2 >> 4) & 0x0f
  const sampleIdx = (b2 >> 2) & 0x03
  const padding = (b2 >> 1) & 0x01

  const bitrate = MP3_BITRATES_V1_L3[bitrateIdx]
  const sampleRate = MP3_SAMPLE_RATES[sampleIdx]

  if (!bitrate || !sampleRate) return null

  const frameSize = Math.floor((144 * (bitrate * 1000)) / sampleRate) + padding
  return { frameSize, sampleRate }
}

async function buildMp3Index(url: string): Promise<FrameIndex> {
  // Fetch the first 256 KB to probe for the initial frame parameters.
  const headResponse = await fetch(url, { headers: { Range: 'bytes=0-262143' } })
  const headBuffer = await headResponse.arrayBuffer()
  const data = new Uint8Array(headBuffer)

  // Get total file size from Content-Range or Content-Length header.
  // Electron's net.fetch for file:// often omits Content-Range, so fall back
  // to Content-Length.  If both are absent, use data.length as a last resort.
  const contentRange = headResponse.headers.get('content-range') ?? ''
  const totalMatch = contentRange.match(/\/(\d+)$/)
  const totalBytes = totalMatch
    ? parseInt(totalMatch[1])
    : parseInt(headResponse.headers.get('content-length') ?? '0') || data.length

  const frames: FrameEntry[] = []
  let currentTime = 0
  let lastSampleRate = 44100

  // ── ID3v2 tag skip ────────────────────────────────────────────────────────
  // Podcast MP3s often embed cover art in their ID3 tags, making them larger
  // than our initial 256 KB fetch window.  When the tag extends past our
  // buffer, fetch a second 64 KB chunk immediately after the tag.
  let fileBase = 0 // byte offset of scanData relative to the full file
  let scanData = data
  let offset = 0

  if (data.length >= 10 && data[0] === 0x49 && data[1] === 0x44 && data[2] === 0x33) {
    const id3Size =
      ((data[6] & 0x7f) << 21) |
      ((data[7] & 0x7f) << 14) |
      ((data[8] & 0x7f) << 7) |
      (data[9] & 0x7f)
    const tagEnd = 10 + id3Size

    if (tagEnd >= data.length) {
      // Tag larger than initial buffer — fetch 64 KB right after it
      const fetchEnd = tagEnd + 65535
      try {
        const secondResp = await fetch(url, { headers: { Range: `bytes=${tagEnd}-${fetchEnd}` } })
        const secondBuf = await secondResp.arrayBuffer()
        scanData = new Uint8Array(secondBuf)
        fileBase = tagEnd
        offset = 0
      } catch {
        console.warn(
          '[FrameIndex] MP3 second-chunk fetch failed after large ID3 — uniform fallback',
        )
        return buildUniformIndex(url, 'mp3', MP3_SAMPLES_PER_FRAME)
      }
    } else {
      offset = tagEnd
    }
  }

  // ── Frame scan ────────────────────────────────────────────────────────────
  let framesScanned = 0

  while (offset + 4 < scanData.length) {
    const result = parseMp3Header(scanData[offset], scanData[offset + 1], scanData[offset + 2])
    if (!result) {
      offset++
      continue
    }

    const { frameSize, sampleRate } = result
    lastSampleRate = sampleRate
    const frameDuration = MP3_SAMPLES_PER_FRAME / sampleRate

    // Sparse index (every ~0.5 s) to keep memory reasonable
    if (framesScanned % Math.max(1, Math.round((0.5 * sampleRate) / MP3_SAMPLES_PER_FRAME)) === 0) {
      frames.push({ byteOffset: fileBase + offset, time: currentTime, duration: frameDuration })
    }

    currentTime += frameDuration
    offset += frameSize
    framesScanned++
  }

  // ── Fallback when scan found nothing ─────────────────────────────────────
  if (frames.length === 0) {
    console.warn('[FrameIndex] MP3 scan produced no frames — using uniform fallback')
    return buildUniformIndex(url, 'mp3', MP3_SAMPLES_PER_FRAME)
  }

  // ── Extrapolate remaining frames from the total file size ─────────────────
  const bytesScanned = fileBase + scanData.length
  if (totalBytes > bytesScanned) {
    const lastFrame = frames[frames.length - 1]
    const avgBytesPerSec =
      lastFrame.byteOffset > 0 ? lastFrame.byteOffset / Math.max(lastFrame.time, 0.1) : 16000 // 128 kbps fallback

    let extraOffset = bytesScanned
    let extraTime = currentTime

    while (extraOffset < totalBytes) {
      const frameDuration = MP3_SAMPLES_PER_FRAME / lastSampleRate
      frames.push({ byteOffset: extraOffset, time: extraTime, duration: frameDuration })
      const approxFrameSize = Math.round(avgBytesPerSec * frameDuration)
      extraOffset += Math.max(1, approxFrameSize)
      extraTime += frameDuration
    }
  }

  return createIndex(frames)
}

// ── WAV ───────────────────────────────────────────────────────────────────────
//
// WAV (PCM) has no frames — byte offset maps directly to time.
// We create a synthetic index with one entry per second for fast seeking.

async function buildWavIndex(url: string): Promise<FrameIndex> {
  // Fetch the first 44 bytes using a streaming read — safe for large WAV files.
  // IMPORTANT: do NOT call resp.arrayBuffer() here.  If the server ignores the
  // Range header and returns the full body, arrayBuffer() would load hundreds of
  // MB into renderer memory and crash.
  const headResp = await fetch(url, { headers: { Range: 'bytes=0-43' } })

  // ── Total file size ───────────────────────────────────────────────────────
  const cr = headResp.headers.get('content-range') ?? ''
  const crMatch = cr.match(/\/(\d+)$/)
  let totalBytes = crMatch
    ? parseInt(crMatch[1])
    : parseInt(headResp.headers.get('content-length') ?? '0')

  // ── Stream-read only the first 44 bytes ───────────────────────────────────
  const reader = headResp.body!.getReader()
  const scratch = new Uint8Array(44)
  let bytesRead = 0
  while (bytesRead < 44) {
    const { done, value } = await reader.read()
    if (done || !value) break
    const toCopy = Math.min(value.length, 44 - bytesRead)
    scratch.set(value.subarray(0, toCopy), bytesRead)
    bytesRead += toCopy
  }
  reader.cancel().catch(() => {
    /* ignore */
  })

  const header = new DataView(scratch.buffer)

  // ── RIFF chunk-size fallback ──────────────────────────────────────────────
  // Electron's net.fetch for file:// URLs often omits Content-Length and
  // Content-Range, leaving totalBytes = 0.  Bytes 4-7 of a RIFF/WAV file
  // always contain (fileSize - 8) as uint32 LE.
  if (totalBytes === 0 && bytesRead >= 8) {
    totalBytes = header.getUint32(4, true) + 8
  }

  // WAV header: "RIFF" at 0, "WAVE" at 8, "fmt " at 12
  const channels = header.getUint16(22, true)
  const sampleRate = header.getUint32(24, true)
  const bitDepth = header.getUint16(34, true)
  const dataOffset = 44 // standard PCM header

  const bytesPerSample = (bitDepth / 8) * channels
  const bytesPerSecond = sampleRate * bytesPerSample

  const dataBytes = totalBytes > 0 ? totalBytes - dataOffset : 0

  const frames: FrameEntry[] = []
  const stepSeconds = 1.0 // one entry per second

  for (let t = 0; t * bytesPerSecond < dataBytes; t += stepSeconds) {
    const byteOffset = dataOffset + Math.floor(t * bytesPerSecond)
    frames.push({ byteOffset, time: t, duration: stepSeconds })
  }

  return createIndex(frames)
}

// ── M4A / AAC ────────────────────────────────────────────────────────────────
//
// M4A uses the same uniform AAC index that was the reachable fallback before
// the unused MP4Box dependency was removed.

async function buildM4aIndex(url: string): Promise<FrameIndex> {
  return buildUniformIndex(url, 'aac', 1024)
}

// ── Uniform fallback ──────────────────────────────────────────────────────────
//
// When we can't parse the container, estimate frame positions from the
// typical samples-per-frame for the codec. Good enough for FLAC and AAC
// when the exact parser isn't available.

async function buildUniformIndex(
  url: string,
  _codec: string,
  samplesPerFrame: number,
): Promise<FrameIndex> {
  // Get file size and rough duration from headers
  const resp = await fetch(url, { method: 'HEAD' })
  const contentLength = parseInt(resp.headers.get('content-length') ?? '0')

  // Assume 128 kbps for estimating duration if we have no better info
  const estimatedDuration = contentLength / ((128 * 1000) / 8)
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
      let lo = 0,
        hi = frames.length - 1
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
