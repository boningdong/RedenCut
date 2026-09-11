import type { TranslationResource } from './en'

export const simplifiedChineseResources = {
  common: {
    cancel: '取消',
    trackCount_one: '{{count}} 个音轨',
    trackCount_other: '{{count}} 个音轨',
  },
  app: {
    languageLabel: '语言',
    followSystem: '跟随系统',
    english: 'English',
    simplifiedChinese: '简体中文',
  },
  transport: {},
  waveform: {},
  transcript: {},
  export: {
    title: '导出',
  },
  workspace: {},
  dialogs: {},
  progress: {},
  errors: {
    generic: '出现了问题。',
    openFile: '无法打开 {{filename}}。',
  },
} as const satisfies TranslationResource
