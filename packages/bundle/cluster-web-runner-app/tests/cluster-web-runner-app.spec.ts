/**
 * The cluster-web runner bundle's composition: layering dsh-base, dsh-web-app,
 * dsh-cluster-web-app, and this bundle's patch through the production composer
 * must keep the API composition intact and add the Postgres lease and the
 * auto-starting dispatch loop; the loop's `nodeId` must come from
 * `DSH_NODE_ID`, which `agent-dispatch` requires before the loop may run.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { evaluate } from '@deepseek-ai/cordis-plugin-loader'
import { composeStack, entryById } from '../../cluster-web-app/tests/helpers/layers.ts'

/** The composed `cluster-web-runner` profile tree (API stack plus this bundle). */
function runnerStack(): ReturnType<typeof composeStack> {
  const root = fileURLToPath(new URL('..', import.meta.url))
  return composeStack(
    ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-cluster-web-app'],
    resolve(root, 'cordis.patch.yml'),
  )
}

describe('dsh-cluster-web-runner-app bundle', () => {
  it('declares the patch file and resolver-manifest dependencies for its inserted rows', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(manifest.dependencies).toHaveProperty('@deepseek-ai/dsh-session-lease-postgres')
    expect(manifest.dependencies).toHaveProperty('@deepseek-ai/dsh-agent-dispatch')
  })

  it('adds the lease and dispatch rows over the intact API composition', () => {
    // The API layer underneath stays as the cluster-web-api profile ships it.
    const entries = runnerStack()
    expect(entryById(entries, 'web-runtime')).toMatchObject({ config: { serveFrontend: false } })
    expect(entryById(entries, 'session-persistence-postgres')).toBeDefined()

    const lease = entryById(entries, 'session-lease-postgres')
    expect(lease.name).toBe('@deepseek-ai/dsh-session-lease-postgres')
    expect(lease.config).toMatchObject({
      connectionString: { __jsExpr: 'process.env.DATABASE_URL' },
      max: 2,
    })

    const dispatch = entryById(entries, 'agent-dispatch')
    expect(dispatch.name).toBe('@deepseek-ai/dsh-agent-dispatch')
    expect(dispatch.config).toMatchObject({
      connectionString: { __jsExpr: 'process.env.DATABASE_URL' },
      nodeId: { __jsExpr: 'process.env.DSH_NODE_ID' },
      max: 2,
      pollMs: 250,
      runner: true,
    })
  })

  it('reads the lease identity from DSH_NODE_ID', () => {
    expect(evaluate({ process: { env: {} } }, 'process.env.DSH_NODE_ID')).toBe(undefined)
    expect(evaluate({ process: { env: { DSH_NODE_ID: 'runner-1' } } }, 'process.env.DSH_NODE_ID'))
      .toBe('runner-1')
  })
})
