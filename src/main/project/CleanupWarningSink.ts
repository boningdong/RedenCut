export type CleanupWarningOperation =
  'workspace-switch' | 'save-as-publication' | 'export-publication'

type CleanupWarningKind = 'temporary-workspace' | 'destination-backup'

export interface CleanupWarning {
  path: string
  operation: CleanupWarningOperation
  kind: CleanupWarningKind
  cause: unknown
}

export interface CleanupWarningSink {
  record(warning: CleanupWarning): void | Promise<void>
}

export class CleanupWarningStore implements CleanupWarningSink {
  private readonly warnings: CleanupWarning[] = []

  record(warning: CleanupWarning): void {
    this.warnings.push(warning)
  }

  pending(): readonly CleanupWarning[] {
    return [...this.warnings]
  }
}

export const discardCleanupWarnings: CleanupWarningSink = {
  record: () => undefined,
}

export async function recordCleanupWarning(
  sink: CleanupWarningSink,
  warning: CleanupWarning,
): Promise<void> {
  try {
    await sink.record(warning)
  } catch {
    // Cleanup follows a commit boundary, so warning persistence cannot undo the committed result.
  }
}
