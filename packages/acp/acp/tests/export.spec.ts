/** S55: ACP session export trio over the real bridge — chunking, cursor lifecycle, failure mapping. */

import { Buffer } from 'node:buffer'
import { afterEach, describe, expect, it } from 'vitest'
import { unzipSync } from 'fflate'
import { Context } from '@deepseek-ai/cordis'
import { PROTOCOL_VERSION, RequestError } from '@agentclientprotocol/sdk'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionRecord } from '@deepseek-ai/dsh-session-query'
import { SessionPersistenceNotFoundError } from '@deepseek-ai/dsh-session-persistence'
import { readSessionLogText, streamSessionLogZip } from '@deepseek-ai/dsh-session-log-export'
import type { SessionLineageNode } from '@deepseek-ai/dsh-session-query'
import * as AcpPlugin from '../src/index.ts'
import {
  beginSessionExport,
  DEFAULT_EXPORT_CHUNK_BYTES,
  EXPORT_BEGIN_METHOD,
  EXPORT_CANCEL_METHOD,
  EXPORT_READ_METHOD,
  MAX_EXPORT_CHUNK_BYTES,
  MIN_EXPORT_CHUNK_BYTES,
  parseExportBeginRequest,
  parseExportCursorRequest,
  SessionExportCursor,
  SessionExportRegistry,
  sessionExportBeginWireError,
  sessionExportReadWireError,
  unknownExportCursor,
  type SessionExportId,
} from '../src/index.ts'
import { makeBridgeHarness, textResponse, type BridgeHarness } from './harness.ts'
import { reported } from './helpers/reporter.ts'

/** JSON-RPC codes the SDK maps wire errors onto. */
const INVALID_PARAMS = -32602
const INTERNAL_ERROR = -32603

/** Report one case of this suite's OpenLogos ids from the wrapping `it`. */
function c(id: string, name: string, fn: () => Promise<void>): void {
  it(name, () => reported(id, fn))
}

/** Settle a rejected wire call into its RequestError, or undefined for anything else. */
function wireError<T>(call: PromiseLike<T> | T): Promise<RequestError | undefined> {
  return Promise.resolve(call).then(
    () => { throw new Error('expected the wire call to fail') },
    (error: unknown) => (error instanceof RequestError ? error : undefined),
  )
}

/** Capture a synchronous throw, or fail when the call returns. */
function syncError(call: () => unknown): unknown {
  try {
    call()
  } catch (error: unknown) {
    return error
  }
  throw new Error('expected the call to throw')
}

/** Mount a fake session-query whose lineage carries the given descendant ids. */
function provideFakeSessionQuery(harness: BridgeHarness, descendantIds: string[] = []): void {
  const descendants: SessionLineageNode[] = descendantIds.map(id => ({
    session: {
      header: { id: brandString<SessionId>(id), version: 4, createdAt: 0, isSeeded: false },
      live: false,
      persisted: true,
    },
    descendants: [],
  }))
  harness.ctx.provide('sessionQuery', {
    async traceSession() {
      return { target: {} as SessionRecord, ancestors: [], descendants }
    },
  } as never)
}

/** Drive one scripted text turn on a fresh bridge-owned session. */
async function drivenSession(harness: BridgeHarness, marker: string): Promise<string> {
  const created = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
  await harness.client.prompt({ sessionId: created.sessionId, prompt: [{ type: 'text', text: marker }] })
  return created.sessionId
}

/** Read one export cursor to completion and assemble its wire chunks. */
async function readToEof(harness: BridgeHarness, exportId: string): Promise<{ data: string; eof: boolean }[]> {
  const responses: { data: string; eof: boolean }[] = []
  for (;;) {
    const response = await harness.client.exportRead({ exportId })
    responses.push(response)
    if (response.eof) return responses
  }
}

/** Decode wire base64 chunks and unzip the archive into its entries. */
function unzipWireArchive(chunks: string[]): Record<string, Uint8Array> {
  const bytes = Buffer.concat(chunks.map(chunk => Buffer.from(chunk, 'base64')))
  return unzipSync(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength))
}

/** A cursor over a closed stream of fixed-size filler chunks. */
function cursorOver(chunkSizes: number[], id = 'cursor-1'): SessionExportCursor {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const size of chunkSizes) controller.enqueue(new Uint8Array(size).fill(7))
      controller.close()
    },
  })
  return new SessionExportCursor(
    brandString<SessionExportId>(id),
    `dsh-session-${id}.zip`,
    stream.getReader(),
    new AbortController(),
  )
}

describe('ACP session export (S55)', () => {
  let harness: BridgeHarness | undefined

  afterEach(async () => {
    await harness?.dispose()
    harness = undefined
  })

  c('UT-S55-01', 'opens a live-flushed export with the canonical filename and HTTP-route layout', async () => {
    harness = await makeBridgeHarness({ script: [textResponse('archived answer one.')] })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    provideFakeSessionQuery(harness)
    expect(EXPORT_BEGIN_METHOD).toBe('session/export_begin')
    expect(EXPORT_READ_METHOD).toBe('session/export_read')
    expect(EXPORT_CANCEL_METHOD).toBe('session/export_cancel')
    const sessionId = await drivenSession(harness, 'archive me please')

    const begun = await harness.client.exportBegin({ sessionId })
    expect(begun.exportId).toMatch(/^[0-9a-f-]{36}$/)
    expect(begun.filename).toBe(`dsh-session-${sessionId}.zip`)

    const responses = await readToEof(harness, begun.exportId)
    expect(responses.at(-1)?.eof).toBe(true)
    const entries = unzipWireArchive(responses.map(response => response.data))
    expect(Object.keys(entries)).toEqual(['session.v4.jsonl'])
    const log = Buffer.from(entries['session.v4.jsonl']!).toString('utf-8')
    expect(log).toContain('"id":"')
    expect(log).toContain('archive me please')
    expect(log).toContain('archived answer one.')

    // The wire archive equals the direct producer over identical inputs (deterministic DEFLATE).
    const persistence = harness.ctx.get('sessionPersistence')!
    const rootContent = await readSessionLogText(persistence, SessionId(sessionId))
    expect(rootContent).toBeDefined()
    const ready = {
      sessionQuery: harness.ctx.get('sessionQuery')!,
      sessionPersistence: persistence,
      attachments: harness.ctx.get('attachments')!,
      sessions: harness.ctx.get('sessions'),
    }
    const direct = streamSessionLogZip(ready, rootContent!, SessionId(sessionId), false, 6, new AbortController().signal)
    const directReader = direct.getReader()
    const directBytes: Uint8Array[] = []
    for (;;) {
      const next = await directReader.read()
      if (next.done) break
      directBytes.push(next.value)
    }
    const wireBytes = Buffer.concat(responses.map(response => Buffer.from(response.data, 'base64')))
    const directFlat = Buffer.concat(directBytes.map(chunk => Buffer.from(chunk)))
    expect(wireBytes.equals(directFlat)).toBe(true)
  })

  c('UT-S55-02', 'chunks reads below the limit and delivers canonical base64 until eof', async () => {
    // Split: one oversized producer chunk is sliced, the remainder arrives on the next read.
    const split = cursorOver([5000])
    const first = await split.read(3000)
    expect(first.eof).toBe(false)
    expect(Buffer.from(first.data, 'base64')).toEqual(Buffer.alloc(3000, 7))
    const second = await split.read(3000)
    expect(second).toEqual({ data: Buffer.alloc(2000, 7).toString('base64'), eof: true })
    // Exact boundary: the aligned limit drains on one read, then an empty terminal response.
    const aligned = cursorOver([1000, 1000])
    expect(await aligned.read(2000)).toEqual({ data: Buffer.alloc(2000, 7).toString('base64'), eof: false })
    expect(await aligned.read(2000)).toEqual({ data: '', eof: true })
    // Every wire chunk is canonical base64 and within the inflated chunk ceiling.
    harness = await makeBridgeHarness({ script: [textResponse('chunked answer.')], config: { exportChunkBytes: MIN_EXPORT_CHUNK_BYTES } })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    provideFakeSessionQuery(harness)
    const sessionId = await drivenSession(harness, 'chunk boundary probe')
    const begun = await harness.client.exportBegin({ sessionId })
    const responses = await readToEof(harness, begun.exportId)
    for (const response of responses) {
      expect(response.data).toBe(Buffer.from(response.data, 'base64').toString('base64'))
      expect(Buffer.from(response.data, 'base64').byteLength).toBeLessThanOrEqual(MIN_EXPORT_CHUNK_BYTES)
    }
    expect(responses.length).toBeGreaterThan(0)
  })

  c('UT-S55-03', 'cancels cursors and leaves no revivable state', async () => {
    harness = await makeBridgeHarness({ script: [textResponse('cancelled export answer.')] })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    provideFakeSessionQuery(harness)
    const sessionId = await drivenSession(harness, 'cancel me')
    const begun = await harness.client.exportBegin({ sessionId })
    expect(await harness.client.exportCancel({ exportId: begun.exportId })).toEqual({})
    const read = await wireError(harness.client.exportRead({ exportId: begun.exportId }))
    expect(read?.code).toBe(INVALID_PARAMS)
    expect(read?.data).toEqual({ code: 'unknown_cursor' })
    const recancel = await wireError(harness.client.exportCancel({ exportId: begun.exportId }))
    expect(recancel?.data).toEqual({ code: 'unknown_cursor' })

    // A direct post-cancel read loses the abort race and maps to the same unknown-cursor word.
    const direct = cursorOver([100])
    direct.cancel()
    const raced = await wireError(
      direct.read(MIN_EXPORT_CHUNK_BYTES).catch((error: unknown) => {
        throw sessionExportReadWireError(error)
      }),
    )
    expect(raced?.data).toEqual({ code: 'unknown_cursor' })

    // Cancelling an already-errored stream: the reader's cancel rejection is contained.
    const errorStream = new ReadableStream<Uint8Array>({
      start(controller) { controller.error(new Error('boom')) },
    })
    const errored = new SessionExportCursor(
      brandString<SessionExportId>('errored'),
      'dsh-session-errored.zip',
      errorStream.getReader(),
      new AbortController(),
    )
    await wireError(errored.read(10))
    errored.cancel()
    expect(sessionExportReadWireError(unknownExportCursor()).code).toBe(INVALID_PARAMS)
    expect(sessionExportReadWireError(new Error('producer blew up')).data).toEqual({ code: 'export_failed' })
    expect(sessionExportReadWireError(unknownExportCursor()).code).toBe(INVALID_PARAMS)
    expect(sessionExportReadWireError(new Error('producer blew up')).data).toEqual({ code: 'export_failed' })
  })

  c('UT-S55-04', 'rejects unknown sessions and unknown cursors without existence leaks', async () => {
    harness = await makeBridgeHarness({ script: [textResponse('unused.')] })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const begin = await wireError(harness.client.exportBegin({ sessionId: 'no-such-session' }))
    expect(begin?.code).toBe(INVALID_PARAMS)
    expect(begin?.message).toBe('Invalid params: unknown session: no-such-session')
    const read = await wireError(harness.client.exportRead({ exportId: '00000000-0000-0000-0000-000000000000' }))
    expect(read?.code).toBe(INVALID_PARAMS)
    expect(read?.data).toEqual({ code: 'unknown_cursor' })
    const cancel = await wireError(harness.client.exportCancel({ exportId: 'fabricated' }))
    expect(cancel?.data).toEqual({ code: 'unknown_cursor' })

    expect(parseExportBeginRequest({ sessionId: 's' })).toEqual({ sessionId: 's', includeDescendants: false })
    expect(parseExportBeginRequest({ sessionId: 's', includeDescendants: true }).includeDescendants).toBe(true)
    for (const probe of [undefined, null, [], 'x', {}, { sessionId: 42 }, { sessionId: '' }, { sessionId: 's', includeDescendants: 'yes' }]) {
      const error = syncError(() => parseExportBeginRequest(probe))
      expect((error as RequestError).code).toBe(INVALID_PARAMS)
    }
    for (const probe of [undefined, null, 7, {}, { exportId: '' }, { other: 1 }]) {
      const error = syncError(() => parseExportCursorRequest(probe))
      expect((error as RequestError).code).toBe(INVALID_PARAMS)
    }
  })

  c('UT-S55-05', 'answers missing roots before any byte and sanitizes mid-stream failures', async () => {
    // Root missing: the begin flow answers before any cursor exists; cordis forbids
    // overwriting a mounted service, so this drives the begin entry point directly.
    const registry = new SessionExportRegistry()
    const fakeCtx = {
      get: (name: string) => {
        if (name === 'sessionQuery') {
          return { async traceSession() { return { target: {}, ancestors: [], descendants: [] } } }
        }
        if (name === 'sessionPersistence') {
          return {
            open: async () => {
              throw new SessionPersistenceNotFoundError(SessionId('s-missing'))
            },
          }
        }
        if (name === 'attachments') return {}
        return undefined
      },
    }
    const missing = await wireError(
      beginSessionExport(
        fakeCtx as never,
        registry,
        { sessionId: 's-missing', includeDescendants: false },
        6,
        new AbortController().signal,
      ),
    )
    expect(missing?.code).toBe(INTERNAL_ERROR)
    expect(missing?.data).toEqual({ code: 'not_found' })
    expect(missing?.message).toBe('Internal error: session "s-missing" has no exportable log')
    expect(sessionExportBeginWireError(missing!)).toBe(missing)
    expect(registry.get('s-missing')).toBeUndefined()

    // Mid-stream producer failure: the descendant log is absent, the message is sanitized.
    harness = await makeBridgeHarness({ script: [textResponse('descendant answer.')] })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    provideFakeSessionQuery(harness, ['child-without-log'])
    const rootId = await drivenSession(harness, 'trace a ghost child')
    const begun = await harness.client.exportBegin({ sessionId: rootId, includeDescendants: true })
    const failed = await wireError(harness.client.exportRead({ exportId: begun.exportId }))
    expect(failed?.code).toBe(INTERNAL_ERROR)
    expect(failed?.data).toEqual({ code: 'export_failed' })
    expect(failed?.message).toBe('Internal error: session export stream failed')
    const after = await wireError(harness.client.exportRead({ exportId: begun.exportId }))
    expect(after?.data).toEqual({ code: 'unknown_cursor' })
    expect(sessionExportBeginWireError(new Error('composition detail')).data).toEqual({ code: 'export_failed' })
  })

  c('UT-S55-06', 'keeps concurrent snapshots independent and aborts everything on teardown', async () => {
    harness = await makeBridgeHarness({ script: [textResponse('a.'), textResponse('b.')] })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    provideFakeSessionQuery(harness)
    const sessionId = await drivenSession(harness, 'snapshot twice')
    const first = await harness.client.exportBegin({ sessionId })
    const second = await harness.client.exportBegin({ sessionId })
    expect(first.exportId).not.toBe(second.exportId)
    const [left, right] = await Promise.all([readToEof(harness, first.exportId), readToEof(harness, second.exportId)])
    expect(unzipWireArchive(left.map(response => response.data))).toEqual(unzipWireArchive(right.map(response => response.data)))
    for (const exportId of [first.exportId, second.exportId]) {
      const drained = await wireError(harness.client.exportRead({ exportId }))
      expect(drained?.data).toEqual({ code: 'unknown_cursor' })
    }

    // Registry teardown aborts every open cursor.
    const registry = new SessionExportRegistry()
    const held = cursorOver([10, 10], 'held')
    registry.add(held)
    registry.abortAll()
    await expect(held.read(10)).rejects.toThrow()
    expect(registry.take('held')).toBeUndefined()
  })

  c('UT-S55-07', 'validates config at load and includes descendant logs on request', async () => {
    for (const [field, config] of [
      ['exportChunkBytes', { exportChunkBytes: 1024 }],
      ['exportChunkBytes', { exportChunkBytes: MAX_EXPORT_CHUNK_BYTES + 1 }],
      ['exportCompressionLevel', { exportCompressionLevel: 12 }],
    ] as const) {
      const ctx = new Context()
      ctx.provide('agents', {} as never)
      ctx.provide('llm', {} as never)
      ctx.provide('sessionPersistence', {} as never)
      ctx.provide('sessions', {} as never)
      await expect(ctx.plugin(AcpPlugin, { ...config })).rejects.toThrow(field)
      await ctx.fiber.dispose()
    }
    expect(DEFAULT_EXPORT_CHUNK_BYTES).toBe(262144)
    expect(MIN_EXPORT_CHUNK_BYTES).toBe(16384)
    expect(MAX_EXPORT_CHUNK_BYTES).toBe(4194304)

    // includeDescendants pulls each traced subagent log into subagents/<id>/.
    harness = await makeBridgeHarness({ script: [textResponse('root answer.'), textResponse('child answer.')] })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const childId = await drivenSession(harness, 'i am the subagent log')
    provideFakeSessionQuery(harness, [childId])
    const rootId = await drivenSession(harness, 'i am the root log')
    const begun = await harness.client.exportBegin({ sessionId: rootId, includeDescendants: true })
    const entries = unzipWireArchive((await readToEof(harness, begun.exportId)).map(response => response.data))
    expect(Object.keys(entries).sort()).toEqual(
      [`subagents/${childId}/session.v4.jsonl`, 'session.v4.jsonl'].sort(),
    )
    expect(Buffer.from(entries[`subagents/${childId}/session.v4.jsonl`]!).toString('utf-8')).toContain('i am the subagent log')
  })

  c('UT-S55-08', 'fails all three methods after disposal and names absent services', async () => {
    harness = await makeBridgeHarness({ script: [textResponse('unused.')] })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    provideFakeSessionQuery(harness)
    const sessionId = await drivenSession(harness, 'dispose after me')
    const begun = await harness.client.exportBegin({ sessionId })
    const client = harness.client
    const done = harness
    harness = undefined
    await done.dispose()
    const read = await wireError(client.exportRead({ exportId: begun.exportId }))
    expect(read?.code).toBe(INTERNAL_ERROR)
    const cancel = await wireError(client.exportCancel({ exportId: begun.exportId }))
    expect(cancel?.code).toBe(INTERNAL_ERROR)
    const begin = await wireError(client.exportBegin({ sessionId }))
    expect(begin?.code).toBe(INTERNAL_ERROR)
    const registry = new SessionExportRegistry()
    await expect(
      beginSessionExport(
        { get: () => undefined } as never,
        registry,
        { sessionId: 's', includeDescendants: false },
        6,
        new AbortController().signal,
      ),
    ).rejects.toThrow('dsh-session-query, @deepseek-ai/dsh-session-persistence, and @deepseek-ai/dsh-attachment')
    expect(registry.take('anything')).toBeUndefined()
  })
})
