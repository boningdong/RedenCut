import type { DiagnosticCollectionRequest } from '@shared/DiagnosticBundleTypes'
import { DiagnosticCollectionPanel } from '../diagnostics/DiagnosticCollectionPanel'

export function DiagnosticsSettings({
  request = { kind: 'recent' },
  autoCollect = false,
}: {
  request?: DiagnosticCollectionRequest
  autoCollect?: boolean
}) {
  return <DiagnosticCollectionPanel request={request} autoCollect={autoCollect} />
}
