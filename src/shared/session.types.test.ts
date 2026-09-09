import { expectTypeOf, test } from 'vitest'
import './session.types'
import type {
  ProjectDraft,
  ProjectMutationRequest,
  RendererAudioSource,
  RendererSession,
  SessionPrecondition,
  WorkspaceToken,
} from './session.types'

test('renderer session contracts expose only the path-free session shape', () => {
  expectTypeOf<WorkspaceToken>().toMatchTypeOf<string>()
  expectTypeOf<SessionPrecondition>().toMatchTypeOf<{
    workspaceToken: WorkspaceToken
    revision: number
  }>()
  expectTypeOf<RendererAudioSource>().toMatchTypeOf<{
    id: RendererAudioSource['id']
    cache: RendererAudioSource['cache']
  }>()
  expectTypeOf<ProjectDraft>().toMatchTypeOf<{
    tracks: ProjectDraft['tracks']
    export: ProjectDraft['export']
  }>()
  expectTypeOf<RendererSession>().toMatchTypeOf<SessionPrecondition>()
  expectTypeOf<RendererSession['speechAnalyses']>().toBeArray()
  expectTypeOf<ProjectMutationRequest>().toMatchTypeOf<SessionPrecondition>()
})
