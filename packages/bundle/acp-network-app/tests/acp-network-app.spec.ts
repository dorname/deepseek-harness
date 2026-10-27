/** The ACP-over-network app bundle's declared profile patch. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { reportResult } from './helpers/reporter.ts'

describe('dsh-acp-network-app bundle', () => {
  it('declares startup-gated ACP-over-network serving without overriding base HMR policy', () => {
    const started = Date.now()
    try {
      const root = fileURLToPath(new URL('..', import.meta.url))
      const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>
        dsh?: { bundle?: { patch?: string } }
      }
      expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
      expect(manifest.dependencies).toHaveProperty('@deepseek-ai/dsh-acp-network')
      const patches = yaml.load(
        readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8'),
        { schema: entryListSchema },
      ) as Array<{
        id?: string
        disabled?: boolean
        insert?: Array<{
          config?: Record<string, unknown>
          id?: string
          inject?: string[]
          name?: string
        }>
      }>
      expect(patches.find(patch => patch.id === 'hmr')).toBeUndefined()
      expect(patches.find(patch => patch.id === 'session-title-llm')).toMatchObject({ disabled: true })
      expect(patches.find(patch => patch.id === 'acp')).toMatchObject({ disabled: true })
      const rows = patches.flatMap(patch => patch.insert ?? [])
      const webserver = rows.find(row => row.id === 'webserver')
      expect(webserver?.name).toBe('@deepseek-ai/dsh-host-webserver')
      expect(webserver?.config?.host).toBeTypeOf('object')
      expect(webserver?.config?.host).toHaveProperty('__jsExpr')
      expect(webserver?.config?.port).toBeTypeOf('object')
      expect(webserver?.config?.port).toHaveProperty('__jsExpr')
      expect(rows.find(row => row.id === 'acp-network-app-startup')?.name).toBe('@deepseek-ai/dsh-acp-network-app')
      expect(rows.find(row => row.id === 'acp-network')).toMatchObject({
        inject: ['acpAppStartup'],
        config: {
          provider: 'deepseek-official',
          model: 'deepseek-v4-flash',
          transport: 'websocket',
          path: '/acp',
        },
      })
      reportResult('UT-S04', 'pass', undefined, Date.now() - started)
    } catch (error) {
      reportResult('UT-S04', 'fail', error instanceof Error ? error.message : String(error), Date.now() - started)
      throw error
    }
  })
})
