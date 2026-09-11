export const englishResources = {
  common: {
    cancel: 'Cancel',
    trackCount_one: '{{count}} track',
    trackCount_other: '{{count}} tracks',
  },
  app: {
    languageLabel: 'Language',
    followSystem: 'Follow System',
    english: 'English',
    simplifiedChinese: '简体中文',
  },
  transport: {},
  waveform: {},
  transcript: {},
  export: {
    title: 'Export',
  },
  workspace: {},
  dialogs: {},
  progress: {},
  errors: {
    generic: 'Something went wrong.',
    openFile: 'Could not open {{filename}}.',
  },
} as const

type WidenResourceLeaves<Resource> = {
  readonly [Key in keyof Resource]: Resource[Key] extends string
    ? string
    : WidenResourceLeaves<Resource[Key]>
}

export type TranslationResource = WidenResourceLeaves<typeof englishResources>
