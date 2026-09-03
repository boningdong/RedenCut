import { z } from 'zod'

export const generationSchema = z.object({
  runId: z.string().min(1),
  generation: z.number().int().positive(),
})
const empty = z.object({}).strict()
const close = generationSchema.extend({ discardUnsaved: z.boolean().optional() }).strict()

export const runtimeTools = [
  {
    name: 'podcut_start',
    schema: empty,
    readOnly: false,
    description:
      'Start one isolated visible Podcut empty-state run from the current built application. Does not install dependencies or build implicitly. Returns runId and generation. Take browser_snapshot before UI actions. Gate B: do not invoke open/import/save/export dialogs; dialog adapters arrive in Gate C.',
  },
  {
    name: 'podcut_status',
    schema: empty,
    readOnly: true,
    description:
      'Read lifecycle state, current identity, startup stage and last failure without accessing the page. Available during transitions and after errors. Also reports surviving orphaned runs with verified process identities; detection is read-only and recovery is manual.',
  },
  {
    name: 'podcut_restart',
    schema: close.extend({ rebuild: z.boolean().optional() }).strict(),
    readOnly: false,
    description:
      'Restart the identified run, optionally rebuilding first. Requires settled work and no unsaved edits unless discardUnsaved is explicitly true. Invalidates all UI references; take a fresh snapshot with the returned generation. A failed build is not silently replaced by an older build.',
  },
  {
    name: 'podcut_stop',
    schema: close,
    readOnly: false,
    description:
      'Close the identified application, flush evidence and preserve run files. Requires settled work and saved edits or explicit discardUnsaved. Does not affect ordinary Podcut instances.',
  },
  {
    name: 'podcut_read_diagnostics',
    schema: generationSchema.strict(),
    readOnly: true,
    description:
      'Read fixed Main isolation/lock and renderer readiness/dirty/busy observations for the current generation. No code evaluation or state mutation is exposed.',
  },
  {
    name: 'podcut_list_artifacts',
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
