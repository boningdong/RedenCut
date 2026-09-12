import { join } from 'node:path'
import { HarnessDialogMailbox } from './HarnessDialogMailbox'
import type { TFunction } from 'i18next'
import { createNativeProjectDialogs } from './nativeProjectDialogs'
import type { ProjectDialogs } from './ProjectDialogs'

// Called only after configureHarnessStartup has validated the run identity.
export function createProjectDialogs(
  harnessMode: boolean,
  env: NodeJS.ProcessEnv,
  getTranslator?: () => TFunction,
): ProjectDialogs {
  if (!harnessMode) return createNativeProjectDialogs(getTranslator)
  const generation = env.RIFFCUT_HARNESS_GENERATION
  if (!generation || !/^[1-9]\d*$/.test(generation)) throw new Error('INVALID_HARNESS_GENERATION')
  const mailbox = new HarnessDialogMailbox(
    join(env.RIFFCUT_HARNESS_RUN_DIRECTORY!, `generation-${generation}`, 'dialogs'),
  )
  return {
    importAudio: async () => mailbox.consume('import-audio'),
    saveProject: async () => mailbox.consume('save-project'),
    openProject: async () => mailbox.consume('open-project'),
    dirtyProject: async () => {
      mailbox.consume('dirty-project')
      throw new Error('UNSUPPORTED_HARNESS_DIALOG')
    },
    exportAudio: async (_window, format) => mailbox.consume('export-audio', format),
  }
}
