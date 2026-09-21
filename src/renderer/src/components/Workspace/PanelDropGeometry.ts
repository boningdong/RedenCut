import type { CSSProperties } from 'react'
import type { WorkspaceLayout } from '@shared/workspaceLayout.types'
import type { WorkspacePanelId } from '../../workspace/workspaceLayout.types'

export const TRANSPORT_DROP_SLOT_HEIGHT = 34

export interface PanelDropGeometry {
  lower: boolean
  style: CSSProperties
}

// Capture geometry before lifting the source so feedback never shifts the hit zones.
export function getPanelDropGeometry(
  panel: WorkspacePanelId,
  layout: WorkspaceLayout,
  bounds: DOMRect,
  destination: DOMRect | undefined,
  x: number,
  y: number,
): PanelDropGeometry | null {
  if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return null
  if (panel === 'transport') {
    const lower = layout.transportPosition === 'top'
    if (lower ? y < bounds.bottom - 76 : y > bounds.top + 76) return null
    return {
      lower,
      style: {
        left: 0,
        width: bounds.width,
        top: lower ? bounds.height - TRANSPORT_DROP_SLOT_HEIGHT : 0,
        height: TRANSPORT_DROP_SLOT_HEIGHT,
      },
    }
  }
  if (
    !destination ||
    y < destination.top + destination.height * 0.24 ||
    y > destination.bottom - destination.height * 0.24
  )
    return null
  return {
    lower: layout.contentOrder[0] === panel,
    style: {
      left: destination.left - bounds.left,
      top: destination.top - bounds.top,
      width: destination.width,
      height: destination.height,
    },
  }
}
