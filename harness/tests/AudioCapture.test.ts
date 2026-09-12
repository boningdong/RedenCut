import { expect, test } from 'vitest'
import { requireContainerAudio } from '../audio/AudioCapture'

test('refuses host execution before starting any audio or Electron process', () => {
  expect(() => requireContainerAudio({})).toThrow(/Docker/)
  expect(() => requireContainerAudio({ REDENCUT_CONTAINER_AUDIO: '1' })).toThrow(/Docker/)
})
