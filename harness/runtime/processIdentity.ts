import { execFileSync } from 'node:child_process'

export interface ProcessIdentity {
  pid: number
  startedAt: string
  command: string
}

export function readProcessIdentity(pid: number): ProcessIdentity | null {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null
  try {
    const read = (field: string) =>
      execFileSync('ps', ['-ww', '-p', String(pid), '-o', `${field}=`], {
        encoding: 'utf8',
        timeout: 1000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
    const startedAt = read('lstart')
    const command = read('command')
    return startedAt && command ? { pid, startedAt, command } : null
  } catch {
    return null
  }
}

export function sameProcess(expected: ProcessIdentity, observed: ProcessIdentity | null): boolean {
  return (
    observed !== null &&
    expected.pid === observed.pid &&
    expected.startedAt === observed.startedAt &&
    expected.command === observed.command
  )
}
