import { describe, expect, it } from 'vitest'
import { needsProjectSave } from './ProjectSaveState'

describe('project departure protection', () => {
  it('protects imported temporary work even when it has no local dirty edit', () => {
    expect(
      needsProjectSave(
        { workspace: { kind: 'temporary' }, sources: [{}], draft: { tracks: [] } },
        false,
      ),
    ).toBe(true)
  })
  it('allows leaving an empty temporary workspace and a clean saved project', () => {
    expect(
      needsProjectSave(
        { workspace: { kind: 'temporary' }, sources: [], draft: { tracks: [] } },
        false,
      ),
    ).toBe(false)
    expect(
      needsProjectSave(
        { workspace: { kind: 'saved' }, sources: [{}], draft: { tracks: [{}] } },
        false,
      ),
    ).toBe(false)
  })
  it('protects local edits in saved projects', () => {
    expect(
      needsProjectSave({ workspace: { kind: 'saved' }, sources: [], draft: { tracks: [] } }, true),
    ).toBe(true)
  })
})
