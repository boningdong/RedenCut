import type { TranslationResource } from './en'

export const simplifiedChineseResources = {
  common: {
    retry: '重试',
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
    modalTitle: '导出音频',
    title: '导出',
  },
  workspace: {},
  dialogs: {
    resetSpeakerNames: '重新分析将重置自定义说话人名称。是否继续？',
    importAudio: '导入音频',
    audioFiles: '音频文件',
    saveProject: '保存 {{appName}} 项目',
    openProject: '打开 {{appName}} 项目',
    untitled: '未命名',
    saveChanges: '打开其他项目前要保存更改吗？',
    save: '保存',
    discard: '不保存',
    exportAudio: '导出音频',
  },
  progress: {},
  errors: {
    loadPreferences: '无法加载语言设置。在重试或选择语言之前，将使用英语。',
    savePreferences: '无法保存语言设置。请重试。',
    invalidPreferences: '语言设置无效，已使用默认设置。',

    generic: '出现了问题。',
    openFile: '无法打开 {{filename}}。',
  },
} as const satisfies TranslationResource
