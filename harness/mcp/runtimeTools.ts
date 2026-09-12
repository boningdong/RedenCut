import { z } from 'zod'
import { HarnessDialogRequestSchema } from '../../src/shared/harnessDialog.types'

export const generationSchema = z.object({
  runId: z.string().min(1),
  generation: z.number().int().positive(),
})
const empty = z.object({}).strict()
const close = generationSchema.extend({ discardUnsaved: z.boolean().optional() }).strict()

export const runtimeTools = [
  {
    name: 'riffcut_prepare_dialog',
    schema: z.object({ ...generationSchema.shape, request: HarnessDialogRequestSchema }).strict(),
    readOnly: false,
    description:
      'Prepare one native-dialog reply before clicking the real UI. request has purpose import-audio with selection {type:file,filename} from e2e/fixtures/audio, or save-project/open-project with selection {type:project,name} within this run, or export-audio with selection {type:export,filename,format} targeting this run’s exports directory (wav/mp3/flac/aac; matching extension; no overwrite), or {type:cancel}. Project names must end in .riffcut. Never replaces a pending reply. Restart clears pending replies. No arbitrary filesystem paths.',
  },
  {
    name: 'riffcut_start',
    schema: empty,
    readOnly: false,
    description:
      'Start one isolated RiffCut run from the current built application. Does not install dependencies or build implicitly. Returns runId and generation. Take browser_snapshot before UI actions. Prepare import/open/save/export dialog replies with riffcut_prepare_dialog before clicking. Dirty-project confirmation is unsupported.',
  },
  {
    name: 'riffcut_status',
    schema: empty,
    readOnly: true,
    description:
      'Read lifecycle state, current identity, startup stage and last failure without accessing the page. Available during transitions and after errors. Also reports surviving orphaned runs with verified process identities; detection is read-only and recovery is manual.',
  },
  {
    name: 'riffcut_restart',
    schema: close.extend({ rebuild: z.boolean().optional() }).strict(),
    readOnly: false,
    description:
      'Restart the identified run, optionally rebuilding first. Requires settled work and no unsaved edits unless discardUnsaved is explicitly true. Invalidates all UI references; take a fresh snapshot with the returned generation. A failed build is not silently replaced by an older build.',
  },
  {
    name: 'riffcut_stop',
    schema: close,
    readOnly: false,
    description:
      'Close the identified application, flush evidence and preserve run files. Requires settled work and saved edits or explicit discardUnsaved. Does not affect ordinary RiffCut instances.',
  },
  {
    name: 'riffcut_read_diagnostics',
    schema: generationSchema.strict(),
    readOnly: true,
    description:
      'Read fixed Main isolation/lock and renderer readiness/dirty/busy observations for the current generation. No code evaluation or state mutation is exposed.',
  },
  {
    name: 'riffcut_list_artifacts',
    schema: empty,
    readOnly: true,
    description:
      'List the current run manifest, logs, screenshots and traces. Returns paths and sizes, never the profile/project directory contents. Evidence remains after application stop.',
  },
] as const

export const allowedUiTools = new Set([
  'browser_snapshot',
  'browser_click',
  'browser_drag',
  'browser_hover',
  'browser_type',
  'browser_press_key',
  'browser_fill_form',
  'browser_select_option',
  'browser_take_screenshot',
  'browser_console_messages',
  'browser_network_requests',
  'browser_find',
  'browser_resize',
  'browser_mouse_move_xy',
  'browser_mouse_click_xy',
  'browser_mouse_drag_xy',
  'browser_mouse_down',
  'browser_mouse_up',
  'browser_mouse_wheel',
])
