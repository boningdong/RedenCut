export type WorkspacePanelId = 'transcript' | 'audio' | 'transport'

export type WorkspaceDropTarget =
  | { kind: 'content-order'; first: 'transcript' | 'audio' }
  | { kind: 'transport-position'; position: 'top' | 'bottom' }
