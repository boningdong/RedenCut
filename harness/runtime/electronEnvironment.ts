export function electronEnvironment(source: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {}
  // Launch options are serialized into traces: never inherit credentials or injection flags.
  for (const key of ['PATH', 'HOME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'DISPLAY', 'XAUTHORITY']) {
    const value = source[key]
    if (value !== undefined) env[key] = value
  }
  for (const key of [
    'REDENCUT_SPEECH_WORKER_ROOT',
    'REDENCUT_SPEECH_WORKER_PYTHON',
    'REDENCUT_SPEECH_MANIFEST',
    'REDENCUT_SPEECH_MODEL_CACHE',
    'REDENCUT_WHISPER_MODEL_DIR',
  ]) {
    const value = source[key]
    if (value !== undefined) env[key] = value
  }
  if (
    source.REDENCUT_CONTAINER_AUDIO === '1' &&
    source.PULSE_SERVER === 'unix:/tmp/redencut-audio/native' &&
    source.PULSE_SINK === 'redencut_test'
  ) {
    env.PULSE_SERVER = source.PULSE_SERVER
    env.PULSE_SINK = source.PULSE_SINK
  }
  return env
}
