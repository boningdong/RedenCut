export function electronEnvironment(source: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {}
  // Launch options are serialized into traces: never inherit credentials or injection flags.
  for (const key of ['PATH', 'HOME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'DISPLAY', 'XAUTHORITY']) {
    const value = source[key]
    if (value !== undefined) env[key] = value
  }
  return env
}
