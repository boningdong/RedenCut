import identity from './AppIdentity.json'

// ─────────────────────────────────────────────────────────────────────────────
// App-wide constants
//
// APP_NAME and APP_FILE_EXT are the two values that will change when the
// project name is finalised. Update AppIdentity.json, shared with the application packager.
// ─────────────────────────────────────────────────────────────────────────────

export const APP_NAME = identity.name
export const APP_FILE_EXT = identity.projectExtension
