/**
 * Unit coverage for `dsh up` flag parsing (replica caps / CPU acceptance).
 */
import { describe, expect, it } from 'vitest'
import { parseUpArgs } from '../src/up.ts'

describe('parseUpArgs', () => {
  it('defaults to smoke-safe replica counts', () => {
    expect(parseUpArgs([])).toMatchObject({
      edgePort: 8080,
      apiReplicas: 1,
      runnerReplicas: 0,
      skipRunners: true,
      skipOverlays: false,
    })
  })

  it('accepts the acceptance ceiling of two replicas', () => {
    expect(parseUpArgs(['--api-replicas', '2', '--runner-replicas', '2'])).toMatchObject({
      apiReplicas: 2,
      runnerReplicas: 2,
      skipRunners: false,
    })
  })

  it('rejects replica counts above the acceptance cap', () => {
    expect(() => parseUpArgs(['--api-replicas', '3'])).toThrow(/api-replicas/)
    expect(() => parseUpArgs(['--runner-replicas', '3'])).toThrow(/runner-replicas/)
  })

  it('honors skip flags', () => {
    expect(parseUpArgs(['--skip-overlays', '--skip-runners'])).toMatchObject({
      skipOverlays: true,
      skipRunners: true,
    })
  })
})
