/**
 * ST-S55-01: session export end-to-end over the network channel.
 *
 * Drives a real acp-network composition (mock model, JSONL persistence, the
 * base-bundle session-query mount) through one prompt, then opens a
 * `session/export_begin` cursor and pulls it to eof over the WebSocket. The
 * assembled bytes land in a temp file and are unzipped from disk, the wire
 * contract (chunk bound, canonical base64, eof terminal, cancel and
 * unknown_cursor vocabulary, unknown-session rejection) is asserted response
 * by response, and the pre-existing method surface keeps working afterwards.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Buffer } from 'node:buffer'
import { unzipSync } from 'fflate'
import { RequestError } from '@agentclientprotocol/sdk'
import { makeNetworkBridgeHarness, textResponse, type NetworkBridgeHarness } from './harness.ts'
import { reportResult } from './helpers/reporter.ts'

/** The ACP wire code invalid params map onto. */
const INVALID_PARAMS = -32602

/** Settle a rejected wire call into its RequestError, or undefined for anything else. */
function wireError<T>(call: PromiseLike<T> | T): Promise<RequestError | undefined> {
  return Promise.resolve(call).then(
    () => { throw new Error('expected the wire call to fail') },
    (error: unknown) => (error instanceof RequestError ? error : undefined),
  )
}

describe('session export over the network channel (ST-S55-01)', () => {
  let harness: NetworkBridgeHarness | undefined
  let archiveDir: string | undefined

  afterEach(async () => {
    await harness?.dispose()
    harness = undefined
    if (archiveDir !== undefined) await rm(archiveDir, { recursive: true, force: true })
    archiveDir = undefined
  })

  it('exports a driven session over the wire and keeps the surface intact', async () => {
    const started = Date.now()
    try {
      harness = await makeNetworkBridgeHarness({
        script: [textResponse('network export answer.'), textResponse('still-exporting answer.')],
        exportChunkBytes: 16384,
      })

      const created = await harness.client.newSession({ cwd: harness.persistenceRoot, mcpServers: [] })
      const sessionId = created.sessionId
      await harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'export me over the wire' }] })

      const begun = await harness.client.exportBegin({ sessionId })
      expect(begun.exportId).toMatch(/^[0-9a-f-]{36}$/)
      expect(begun.filename).toBe(`dsh-session-${sessionId}.zip`)

      // Pull to eof; every response respects the configured bound.
      const responses: { data: string; eof: boolean }[] = []
      for (;;) {
        const response = await harness.client.exportRead({ exportId: begun.exportId })
        responses.push(response)
        expect(Buffer.from(response.data, 'base64').byteLength).toBeLessThanOrEqual(16384)
        expect(response.data).toBe(Buffer.from(response.data, 'base64').toString('base64'))
        if (response.eof) break
      }
      expect(responses.length).toBeGreaterThan(0)

      // 写文件解包断言: land the archive bytes on disk and unzip from the file.
      archiveDir = await mkdtemp(join(tmpdir(), 'dsh-acp-export-st-'))
      const archivePath = join(archiveDir, begun.filename)
      await writeFile(archivePath, Buffer.concat(responses.map(response => Buffer.from(response.data, 'base64'))))
      const entries = unzipSync(new Uint8Array(await readFile(archivePath)))
      expect(Object.keys(entries)).toEqual(['session.v4.jsonl'])
      const log = Buffer.from(entries['session.v4.jsonl']!).toString('utf-8')
      expect(log).toContain('"id":"')
      expect(log).toContain('export me over the wire')
      expect(log).toContain('network export answer.')

      // eof is terminal: the drained cursor answers unknown_cursor.
      const drained = await wireError(harness.client.exportRead({ exportId: begun.exportId }))
      expect(drained?.code).toBe(INVALID_PARAMS)
      expect(drained?.data).toEqual({ code: 'unknown_cursor' })

      // Cancel path: {} now, then the cursor is gone for read and cancel alike.
      const open = await harness.client.exportBegin({ sessionId })
      expect(await harness.client.exportCancel({ exportId: open.exportId })).toEqual({})
      const cancelledRead = await wireError(harness.client.exportRead({ exportId: open.exportId }))
      expect(cancelledRead?.data).toEqual({ code: 'unknown_cursor' })
      const recancel = await wireError(harness.client.exportCancel({ exportId: open.exportId }))
      expect(recancel?.data).toEqual({ code: 'unknown_cursor' })

      // Unknown sessions reject as invalid params without existence leaks.
      const unknownSession = await wireError(harness.client.exportBegin({ sessionId: 'no-such-session' }))
      expect(unknownSession?.code).toBe(INVALID_PARAMS)
      expect(unknownSession?.message).toBe('Invalid params: unknown session: no-such-session')

      // Regression: the pre-existing method surface still routes after export traffic.
      const again = harness.updates.length
      await harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'still here' }] })
      expect(harness.updates.length).toBeGreaterThan(again)
      await harness.client.closeSession({ sessionId })

      reportResult('ST-S55-01', 'pass', undefined, Date.now() - started)
    } catch (error) {
      reportResult('ST-S55-01', 'fail', error instanceof Error ? error.message : String(error), Date.now() - started)
      throw error
    }
  })
})
