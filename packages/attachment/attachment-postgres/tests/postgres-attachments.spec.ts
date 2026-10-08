import { afterAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import postgres from 'postgres'
import sharp from 'sharp'
import type { ImageAttachmentRef, SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import { PostgresAttachmentStore } from '../src/index.ts'
import { ATTACHMENT_POSTGRES_SCHEMA_VERSION } from '../src/schema.ts'
import { freshDatabaseName, startEmbeddedCluster } from './helpers/embedded.ts'
import type { EmbeddedCluster } from './helpers/embedded.ts'
import { reportResult } from './helpers/reporter.ts'

// Top-level await: cluster availability is decided before suite registration,
// so an unavailable environment skips the whole suite explicitly instead of
// failing its cases.
const logs: string[] = []
const cluster: EmbeddedCluster | undefined = await startEmbeddedCluster('dsh_attach_pg_spec', logs)
const unavailable = cluster === undefined
const skipReason = `embedded-postgres binaries unavailable in this environment (${logs.slice(-2).join(' | ') || 'import failed'})`

afterAll(async () => {
  await cluster?.stop()
  if (unavailable) {
    // The skip must be visible and ledger-recorded, never a silent pass.
    for (const id of ['UT-S36-01', 'UT-S36-02', 'UT-S36-03', 'UT-S36-05', 'ST-S36-01']) {
      reportResult(id, 'skip', skipReason)
    }
  }
}, 120000)

if (unavailable) {
  console.warn(`[postgres-attachments.spec] SKIPPED: ${skipReason}`)
}

/** One backend instance over the shared database under one fleet subject. */
async function instance(
  url: string,
  subject?: string,
): Promise<{ ctx: Context; store: PostgresAttachmentStore; dispose: () => Promise<void> }> {
  const previous = process.env.DSH_FLEET_USER_ID
  if (subject === undefined) {
    delete process.env.DSH_FLEET_USER_ID
  } else {
    process.env.DSH_FLEET_USER_ID = subject
  }
  try {
    const ctx = new Context()
    const fiber = await ctx.plugin(PostgresAttachmentStore, { connectionString: url })
    return {
      ctx,
      store: ctx.attachments as PostgresAttachmentStore,
      dispose: async () => {
        await fiber.dispose()
        if (previous === undefined) {
          delete process.env.DSH_FLEET_USER_ID
        } else {
          process.env.DSH_FLEET_USER_ID = previous
        }
      },
    }
  } catch (error: unknown) {
    if (previous === undefined) {
      delete process.env.DSH_FLEET_USER_ID
    } else {
      process.env.DSH_FLEET_USER_ID = previous
    }
    throw error
  }
}

/** One fresh database plus its connection URL. */
async function freshDatabase(): Promise<string> {
  const db = freshDatabaseName('attachments')
  await cluster!.createDatabase(db)
  return cluster!.url(db)
}

/** One encoded PNG with the given pixel dimensions. */
async function png(width: number, height: number): Promise<Uint8Array> {
  return new Uint8Array(await sharp({
    create: { width, height, channels: 3, background: { r: 96, g: 160, b: 220 } },
  }).png().toBuffer())
}

/** A minimal save request over encoded bytes. */
function image(data: Uint8Array): SaveImageAttachment {
  return { data, mediaType: 'image/png' }
}

describe.skipIf(unavailable)('postgres attachment backend', () => {
  it('UT-S36-01: a saved image round-trips byte-for-byte behind an opaque content-addressed id', async () => {
    const started = Date.now()
    const url = await freshDatabase()
    const a = await instance(url)
    try {
      const data = await png(12, 9)
      const ref = await a.store.saveImage(image(data))
      expect(ref.attachmentId).toMatch(/^[0-9a-f]{64}$/)
      expect(ref.mediaType).toBe('image/png')
      expect(ref.width).toBe(12)
      expect(ref.height).toBe(9)
      expect(ref.bytes).toBe(data.byteLength)

      const stored = await a.store.readImage(ref)
      expect(Buffer.from(stored.data).equals(Buffer.from(data))).toBe(true)
      expect(stored.ref.attachmentId).toBe(ref.attachmentId)
      reportResult('UT-S36-01', 'pass', undefined, Date.now() - started)
    } catch (error: unknown) {
      reportResult('UT-S36-01', 'fail', String(error))
      throw error
    } finally {
      await a.dispose()
    }
  })

  it('UT-S36-02: reading an unknown reference fails loudly as not found', async () => {
    const started = Date.now()
    const url = await freshDatabase()
    const a = await instance(url)
    try {
      const forged: ImageAttachmentRef = {
        attachmentId: '0'.repeat(64) as ImageAttachmentRef['attachmentId'],
        mediaType: 'image/png',
        bytes: 1,
        width: 1,
        height: 1,
      }
      await expect(a.store.readImage(forged)).rejects.toMatchObject({ name: 'AttachmentError', code: 'ATTACHMENT_NOT_FOUND' })
      reportResult('UT-S36-02', 'pass', undefined, Date.now() - started)
    } catch (error: unknown) {
      reportResult('UT-S36-02', 'fail', String(error))
      throw error
    } finally {
      await a.dispose()
    }
  })

  it('UT-S36-03: oversized and malformed images are refused with the limit facts', async () => {
    const started = Date.now()
    const url = await freshDatabase()
    const ctx = new Context()
    const fiber = await ctx.plugin(PostgresAttachmentStore, { connectionString: url, maxImageBytes: 64 })
    const store = ctx.attachments as PostgresAttachmentStore
    try {
      const oversized = await png(64, 64)
      await expect(store.saveImage(image(oversized))).rejects.toMatchObject({ code: 'IMAGE_TOO_LARGE' })
      await expect(store.validateImage(image(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]))))
        .rejects.toMatchObject({ code: 'INVALID_IMAGE' })
      // Neither refusal left an object behind.
      const client = postgres(url, { max: 1 })
      const rows = await client.unsafe('SELECT COUNT(*)::int AS count FROM attachment_objects') as Array<{ count: number }>
      await client.end()
      expect(rows[0]?.count).toBe(0)
      reportResult('UT-S36-03', 'pass', undefined, Date.now() - started)
    } catch (error: unknown) {
      reportResult('UT-S36-03', 'fail', String(error))
      throw error
    } finally {
      await fiber.dispose()
    }
  })

  it('UT-S36-05: two fleet subjects never reach each other\'s objects', async () => {
    const started = Date.now()
    const url = await freshDatabase()
    const alice = await instance(url, 'acc-alice')
    const bob = await instance(url, 'acc-bob')
    try {
      const data = await png(4, 4)
      const ref = await alice.store.saveImage(image(data))
      // The same content-addressed reference in Bob's namespace finds nothing…
      await expect(bob.store.readImage(ref)).rejects.toMatchObject({ code: 'ATTACHMENT_NOT_FOUND' })
      // …and saving the same bytes in Bob's namespace stores a second row
      // under Bob's column rather than linking to Alice's: one row per
      // namespace, both under the same digest.
      const bobRef = await bob.store.saveImage(image(data))
      expect(bobRef.attachmentId).toBe(ref.attachmentId)
      const client = postgres(url, { max: 1 })
      const rows = await client.unsafe(
        'SELECT namespace, COUNT(*)::int AS count FROM attachment_objects GROUP BY namespace ORDER BY namespace',
      ) as Array<{ namespace: string; count: number }>
      await client.end()
      expect(rows).toHaveLength(2)
      expect(rows[0]?.namespace).toMatch(/^u[0-9a-f]{16}$/)
      expect(rows[1]?.namespace).toMatch(/^u[0-9a-f]{16}$/)
      expect(rows[0]?.namespace).not.toBe(rows[1]?.namespace)
      expect(rows[0]?.count).toBe(1)
      expect(rows[1]?.count).toBe(1)
      reportResult('UT-S36-05', 'pass', undefined, Date.now() - started)
    } catch (error: unknown) {
      reportResult('UT-S36-05', 'fail', String(error))
      throw error
    } finally {
      await alice.dispose()
      await bob.dispose()
    }
  })

  it('ST-S36-01: a second node reads back the same bytes for the same reference', async () => {
    const started = Date.now()
    const url = await freshDatabase()
    const a = await instance(url, 'acc-alice')
    const b = await instance(url, 'acc-alice')
    try {
      const data = await png(24, 16)
      const ref = await a.store.saveImage(image(data))
      const stored = await b.store.readImage(ref)
      expect(Buffer.from(stored.data).equals(Buffer.from(data))).toBe(true)
      reportResult('ST-S36-01', 'pass', undefined, Date.now() - started)
    } catch (error: unknown) {
      reportResult('ST-S36-01', 'fail', String(error))
      throw error
    } finally {
      await a.dispose()
      await b.dispose()
    }
  })

  it('stamps the shared layout version once and rejects a foreign stamp', async () => {
    const url = await freshDatabase()
    const first = await instance(url)
    await first.store.saveImage(image(await png(2, 2)))
    await first.dispose()

    const client = postgres(url, { max: 1 })
    const rows = await client.unsafe('SELECT version FROM attachment_postgres_meta WHERE singleton = 1') as Array<{ version: number }>
    expect(rows[0]?.version).toBe(ATTACHMENT_POSTGRES_SCHEMA_VERSION)
    await client.unsafe('UPDATE attachment_postgres_meta SET version = 99')
    await client.end()
    const second = await instance(url)
    await expect(second.store.saveImage(image(await png(2, 2)))).rejects.toThrow(/incompatible with this build/)
    await second.dispose()
  })
})
