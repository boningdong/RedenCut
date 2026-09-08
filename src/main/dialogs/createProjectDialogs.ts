import { join } from 'node:path'
import { HarnessDialogMailbox } from './HarnessDialogMailbox'
import { nativeProjectDialogs } from './nativeProjectDialogs'
import type { ProjectDialogs } from './ProjectDialogs'

// Called only after configureHarnessStartup has validated the run identity.
export function createProjectDialogs(harnessMode: boolean, env: NodeJS.ProcessEnv): ProjectDialogs {
  if (!harnessMode) return nativeProjectDialogs
  const generation = env.PODCUT_HARNESS_GENERATION
  if (!generation || !/^[1-9]\d*$/.test(generation)) throw new Error('INVALID_HARNESS_GENERATION')
  const mailbox = new HarnessDialogMailbox(
    join(env.PODCUT_HARNESS_RUN_DIRECTORY!, `generation-${generation}`, 'dialogs'),
  )
  return {
    importAudio: async () => mailbox.consume('import-audio'),
    saveProject: async () => mailbox.consume('save-project'),
    openProject: async () => mailbox.consume('open-project'),
    dirtyProject: async () => {
      mailbox.consume('dirty-project')
      throw new Error('UNSUPPORTED_HARNESS_DIALOG')
    },
    exportAudio: async () => {
      mailbox.consume('export-audio')
      throw new Error('UNSUPPORTED_HARNESS_DIALOG')
    },
  }
}
