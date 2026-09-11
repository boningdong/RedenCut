export const englishResources = {
  common: {
    retry: 'Retry',
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
    modalTitle: 'Export Audio',
    title: 'Export',
  },
  workspace: {},
  dialogs: {
    resetSpeakerNames: 'Re-analysis will reset your custom speaker names. Continue?',
    importAudio: 'Import Audio',
    audioFiles: 'Audio Files',
    saveProject: 'Save {{appName}} Project',
    openProject: 'Open {{appName}} Project',
    untitled: 'Untitled',
    saveChanges: 'Save changes before opening another project?',
    save: 'Save',
    discard: "Don't Save",
    exportAudio: 'Export Audio',
  },
  progress: {},
  errors: {
    loadPreferences:
      'Language settings could not be loaded. English is being used until you retry or choose a language.',
    savePreferences: 'Language could not be saved. Please try again.',
    invalidPreferences: 'Language settings were invalid. Default settings are being used.',

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
