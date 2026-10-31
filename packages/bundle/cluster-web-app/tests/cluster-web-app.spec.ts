/**
 * The cluster-web API bundle's composition: layering dsh-base, dsh-web-app,
 * and this bundle's patch through the production composer must leave the API
 * replica's entry list with the SPA off, local JSONL persistence off, and the
 * shared-Postgres rows in; the Postgres `connectionString` must come from
 * `DATABASE_URL` and be rejected by the plugin schema when absent.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { evaluate } from '@deepseek-ai/cordis-plugin-loader'
import PostgresSessionPersistence from '@deepseek-ai/dsh-session-persistence-postgres'
import { composeStack, entryById } from './helpers/layers.ts'

/** The composed `cluster-web-api` profile tree (dsh-base → dsh-web-app → this bundle). */
function apiStack(): ReturnType<typeof composeStack> {
  const root = fileURLToPath(new URL('..', import.meta.url))
  return composeStack(
    ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],
    resolve(root, 'cordis.patch.yml'),
  )
}

describe('dsh-cluster-web-app bundle', () => {
  it('declares the patch file and resolver-manifest dependencies for its inserted rows', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(manifest.dependencies).toHaveProperty('@deepseek-ai/dsh-session-persistence-postgres')
    expect(manifest.dependencies).toHaveProperty('@deepseek-ai/dsh-stream-relay-postgres')
  })

  it('switches the SPA off by replacing the whole web-runtime config', () => {
    const entry = entryById(apiStack(), 'web-runtime')
    expect(entry.name).toBe('@deepseek-ai/dsh-web-app')
    const config = entry.config as Record<string, unknown>
    // A patch replaces the row's whole config; every web-app key must survive
    // the override, or the API replica silently loses runtime glue.
    expect(Object.keys(config).sort()).toEqual([
      'openBrowser', 'printUrl', 'publicUrl', 'serveFrontend', 'surfaceContext', 'trustLoopbackGateway', 'trustedHosts',
    ].sort())
    expect(config.serveFrontend).toBe(false)
    expect(config.openBrowser).toMatchObject({ __jsExpr: 'ctx.webStartup.openBrowser' })
    expect(config.trustedHosts).toMatchObject({ __jsExpr: 'ctx.webStartup.trustedHosts' })
  })

  it('turns local JSONL persistence off in favor of the shared Postgres rows', () => {
    const entries = apiStack()
    expect(entryById(entries, 'session-persistence-jsonl')).toMatchObject({ disabled: true })
    const persistence = entryById(entries, 'session-persistence-postgres')
    expect(persistence.name).toBe('@deepseek-ai/dsh-session-persistence-postgres')
    expect(persistence.config).toMatchObject({
      connectionString: { __jsExpr: 'process.env.DATABASE_URL' },
      max: 2,
    })
    const relay = entryById(entries, 'stream-relay-postgres')
    expect(relay.name).toBe('@deepseek-ai/dsh-stream-relay-postgres')
    expect(relay.config).toMatchObject({
      connectionString: { __jsExpr: 'process.env.DATABASE_URL' },
      max: 2,
    })
  })

  it('fails a boot without DATABASE_URL instead of falling back to local persistence', () => {
    const expression = 'process.env.DATABASE_URL'
    // Unset environment: the row's expression resolves to no value at all...
    expect(evaluate({ process: { env: {} } }, expression)).toBe(undefined)
    expect(evaluate({ process: { env: { DATABASE_URL: 'postgres://shared/db' } } }, expression))
      .toBe('postgres://shared/db')
    // ...and the persistence plugin's own schema rejects that resolved config,
    // so the row fails at mount rather than mounting without a database.
    expect(() => PostgresSessionPersistence.Config({ max: 2 } as never)).toThrow()
  })
})
