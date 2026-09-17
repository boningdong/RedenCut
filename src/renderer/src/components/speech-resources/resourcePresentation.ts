import type { ResourceCapability, ResourceSnapshot, ResourceState } from '@shared/resources.types'
export function aggregateResource(
  snapshot: ResourceSnapshot | null,
  capability: ResourceCapability,
): ResourceState {
  const rows =
    snapshot?.resources.filter(
      (row) =>
        row.capability === capability &&
        (capability !== 'transcription' ||
          !snapshot.selectedWhisperModelId ||
          row.id === snapshot.selectedWhisperModelId),
    ) ?? []
  const status = rows.length
    ? ((['downloading', 'verifying', 'failed', 'paused', 'missing'] as const).find((value) =>
        rows.some((row) => row.status === value),
      ) ?? 'ready')
    : 'missing'
  return {
    id: capability,
    ...(rows.find((row) => row.status === 'failed' && row.error)?.error
      ? { error: rows.find((row) => row.status === 'failed' && row.error)!.error }
      : {}),
    capability,
    status,
    downloadedBytes: rows.reduce((total, row) => total + row.downloadedBytes, 0),
    totalBytes:
      rows.length && rows.every((row) => row.totalBytes !== null)
        ? rows.reduce((total, row) => total + row.totalBytes!, 0)
        : null,
  }
}
export function resourcePercent(row: ResourceState): number | null {
  return row.totalBytes && row.totalBytes > 0
    ? Math.min(100, Math.floor((row.downloadedBytes / row.totalBytes) * 100))
    : null
}
export function resourcesBusy(snapshot: ResourceSnapshot | null): boolean {
  return (
    snapshot?.resources.some((row) => row.status === 'downloading' || row.status === 'verifying') ??
    false
  )
}
