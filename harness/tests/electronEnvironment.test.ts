import { expect, test } from 'vitest'
import { electronEnvironment } from '../runtime/electronEnvironment'

test('never forwards unrelated credentials or Node/Electron injection variables into launch traces', () => {
  const env = electronEnvironment({
    PATH: '/usr/bin',
    HOME: '/Users/test',
    LANG: 'en_US.UTF-8',
    SECRET_TOKEN: 'sentinel-do-not-record',
    NODE_OPTIONS: '--require malicious',
    ELECTRON_RUN_AS_NODE: '1',
    ELECTRON_RENDERER_URL: 'https://unrelated.example',
  })
  expect(env).toEqual({ PATH: '/usr/bin', HOME: '/Users/test', LANG: 'en_US.UTF-8' })
})

test('forwards only the fixed private container audio endpoint, never arbitrary host endpoints', () => {
  expect(
    electronEnvironment({
      PODCUT_CONTAINER_AUDIO: '1',
      PULSE_SERVER: 'unix:/tmp/podcut-audio/native',
      PULSE_SINK: 'podcut_test',
    }),
  ).toMatchObject({
    PULSE_SERVER: 'unix:/tmp/podcut-audio/native',
    PULSE_SINK: 'podcut_test',
  })
  expect(electronEnvironment({ PULSE_SERVER: 'tcp:host.example', PULSE_SINK: 'speakers' })).toEqual(
    {},
  )
})
