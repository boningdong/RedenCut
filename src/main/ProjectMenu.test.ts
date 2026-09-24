import { expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ template: [] as unknown[], setApplicationMenu: vi.fn() }))
vi.mock('electron', () => ({
  Menu: {
    buildFromTemplate: (template: unknown[]) => {
      mocks.template = template
      return template
    },
    setApplicationMenu: mocks.setApplicationMenu,
  },
}))
import { installProjectMenu } from './ProjectMenu'

it('places recent diagnostic report under localized Help', () => {
  const open = vi.fn()
  installProjectMenu('zh-CN', vi.fn(), open)
  const help = mocks.template.find((item) => (item as { label?: string }).label === '帮助') as {
    submenu: Array<{ label: string; click: () => void }>
  }
  expect(help.submenu[0].label).toContain('最近')
  help.submenu[0].click()
  expect(open).toHaveBeenCalledOnce()
})
