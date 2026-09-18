import { create } from 'zustand'
import type {
  ProjectOpenProgressEvent,
  ProjectOpenStage,
  StageProgress,
} from '@shared/AudioPreparationTypes'
import type { ImportProgressEvent } from '@shared/ipc.types'
import type { SessionPrecondition } from '@shared/session.types'

type Stage = ProjectOpenStage | ImportProgressEvent['stage'] | 'preparing-editor' | 'cancelling'
type ImportIdentity = SessionPrecondition & { jobId: string }
interface PreparationSnapshot {
  id: string
  kind: 'open' | 'import'
  visible: boolean
  stage: Stage
  progress: StageProgress
  displayName?: string
  source?: ProjectOpenProgressEvent['source']
  sequence: number
  identity?: ImportIdentity
  canCancel: boolean
  beforeCancel?: { stage: Stage; progress: StageProgress }
}
interface PreparationState {
  active: PreparationSnapshot | null
  opening: PreparationSnapshot | null
  importing: PreparationSnapshot | null
  beginOpen(id: string): void
  beginImport(identity: ImportIdentity, displayName: string): void
  receiveOpen(event: ProjectOpenProgressEvent): void
  receiveImport(event: ImportProgressEvent): void
  prepareEditor(id: string): void
  cancelling(id: string): void
  cancelFailed(id: string): void
  end(id: string): void
}
const unknown: StageProgress = { kind: 'indeterminate' }
export const usePreparationProgressStore = create<PreparationState>((set) => {
  // Open and import lifetimes can overlap while a native chooser is active.
  // Keep both snapshots so a cancelled open restores the still-running import.
  const update = (
    target: 'open' | 'import' | { id: string },
    change: (state: { active: PreparationSnapshot | null }) => {
      active?: PreparationSnapshot | null
    },
  ) =>
    set((state) => {
      const slot =
        target === 'open'
          ? 'opening'
          : target === 'import'
            ? 'importing'
            : state.opening?.id === target.id
              ? 'opening'
              : 'importing'
      const result = change({ active: state[slot] })
      if (!('active' in result)) return {}
      const next = {
        opening: state.opening,
        importing: state.importing,
        [slot]: result.active ?? null,
      }
      return {
        ...next,
        active: next.opening?.visible ? next.opening : (next.importing ?? next.opening),
      }
    })
  return {
    active: null,
    opening: null,
    importing: null,
    beginOpen: (id) =>
      update('open', () => ({
        active: {
          id,
          kind: 'open',
          visible: false,
          stage: 'reading-project',
          progress: unknown,
          sequence: -1,
          canCancel: false,
        },
      })),
    beginImport: (identity, displayName) =>
      update('import', () => ({
        active: {
          id: identity.jobId,
          identity,
          displayName,
          kind: 'import',
          visible: true,
          stage: 'selected',
          progress: unknown,
          sequence: -1,
          canCancel: true,
        },
      })),
    receiveOpen: (event) =>
      update('open', ({ active }) => {
        if (
          !active ||
          active.kind !== 'open' ||
          active.id !== event.operationId ||
          event.sequence <= active.sequence ||
          active.stage === 'preparing-editor'
        )
          return {}
        return {
          active: {
            ...active,
            visible: true,
            stage: event.stage,
            progress: event.progress,
            sequence: event.sequence,
            source: event.source,
            displayName: event.source?.displayName ?? event.projectDisplayName,
          },
        }
      }),
    receiveImport: (event) =>
      update('import', ({ active }) => {
        if (
          !active ||
          active.kind !== 'import' ||
          active.id !== event.jobId ||
          active.identity?.workspaceToken !== event.workspaceToken ||
          active.identity.revision !== event.revision ||
          active.stage === 'preparing-editor' ||
          active.stage === 'cancelling'
        )
          return {}
        return {
          active: {
            ...active,
            displayName: event.displayName,
            stage: event.stage,
            progress:
              (event.stage === 'building-cache' || event.stage === 'copying') &&
              Number.isFinite(event.percent)
                ? { kind: 'determinate', fraction: Math.max(0, Math.min(1, event.percent)) }
                : unknown,
          },
        }
      }),
    prepareEditor: (id) =>
      update({ id }, ({ active }) =>
        active?.id === id
          ? {
              active: {
                ...active,
                visible: true,
                stage: 'preparing-editor',
                progress: unknown,
                canCancel: false,
                beforeCancel: undefined,
              },
            }
          : {},
      ),
    cancelling: (id) =>
      update({ id }, ({ active }) =>
        active?.id === id && active.canCancel
          ? {
              active: {
                ...active,
                beforeCancel: { stage: active.stage, progress: active.progress },
                stage: 'cancelling',
                progress: unknown,
                canCancel: false,
              },
            }
          : {},
      ),
    cancelFailed: (id) =>
      update({ id }, ({ active }) =>
        active?.id === id && active.stage === 'cancelling' && active.beforeCancel
          ? {
              active: {
                ...active,
                ...active.beforeCancel,
                beforeCancel: undefined,
                canCancel: true,
              },
            }
          : {},
      ),
    end: (id) => update({ id }, ({ active }) => (active?.id === id ? { active: null } : {})),
  }
})
