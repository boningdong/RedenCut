import { describe, expect, it } from 'vitest'
import { aggregateResource, resourcePercent } from './resourcePresentation'
import type { ResourceSnapshot } from '@shared/resources.types'
describe('verified resource presentation', () => {
  it('does not certify alignment until both languages are ready and aggregates real byte counts', () => {
    const snapshot: ResourceSnapshot = {
      revision: 1,
      baseReady: false,
      resources: [
        {
          id: 'zh',
          capability: 'alignment',
          status: 'ready',
          downloadedBytes: 100,
          totalBytes: 100,
        },
        {
          id: 'en',
          capability: 'alignment',
          status: 'verifying',
          downloadedBytes: 300,
          totalBytes: 300,
        },
      ],
    }
    expect(aggregateResource(snapshot, 'alignment')).toMatchObject({
      status: 'verifying',
      downloadedBytes: 400,
      totalBytes: 400,
    })
    snapshot.resources[1].status = 'ready'
    expect(aggregateResource(snapshot, 'alignment').status).toBe('ready')
  })
  it('never invents percentages for unknown totals or readiness for absent resources', () => {
    const resource = aggregateResource(null, 'alignment')
    expect(resource.status).toBe('missing')
    expect(resourcePercent(resource)).toBeNull()
    expect(resourcePercent({ ...resource, downloadedBytes: 10, totalBytes: 30 })).toBe(33)
  })
})
