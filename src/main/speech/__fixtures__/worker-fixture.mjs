import readline from 'node:readline'

const mode = process.argv[2] ?? 'success'
const lines = readline.createInterface({ input: process.stdin })
lines.once('line', (line) => {
  const request = JSON.parse(line)
  const emit = (value) => process.stdout.write(`${JSON.stringify(value)}\n`)
  const envelope = { protocolVersion: 1, jobId: request.jobId }
  if (mode === 'hang') {
    emit({ ...envelope, type: 'ready' })
    const keepAlive = setInterval(() => {}, 1000)
    process.on('SIGTERM', () => {
      clearInterval(keepAlive)
      setTimeout(() => process.exit(0), 20)
    })
    return
  }
  if (mode === 'malformed') {
    process.stdout.write('{bad json}\n')
    return
  }
  if (mode === 'wrong-job') {
    emit({ ...envelope, jobId: 'other', type: 'ready' })
    return
  }
  console.error('fixture diagnostic')
  emit({ ...envelope, type: 'ready' })
  emit({ ...envelope, type: 'progress', stage: 'aligning', percent: 50 })
  const unalignedTranscriptUnitIds =
    mode === 'large-output'
      ? Array.from({ length: 30_000 }, () => request.transcriptUnits[0].id)
      : request.transcriptUnits.map((unit) => unit.id)
  emit({
    ...envelope,
    type: 'result',
    result: {
      alignment: { units: [], unalignedTranscriptUnitIds, provenance: {} },
      diarization: { turns: [], provenance: {} },
    },
  })
  if (mode === 'duplicate') emit({ ...envelope, type: 'error', code: 'late', message: 'late' })
})
