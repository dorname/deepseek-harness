import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import Storage, { UNIT_NAME_RE } from '@deepseek-ai/dsh-storage'
import { DomainError, DomainFacility, NAMESPACE_ENV, assertNamespaceSafeUnitName, defineDomain, domainTable, namespaceUnitName, resolveNamespaceSubject } from '../src/index.ts'
import { MemoryMediaPool, MemoryStorageBackend } from './helpers/memory-backend.ts'
import { reportResult } from './helpers/reporter.ts'

const itemSchema = z.object({ label: z.string() })
type Item = z.infer<typeof itemSchema>

const spec = defineDomain({
  name: 'notes',
  version: 1,
  global: { schema: z.object({ theme: z.string() }), initial: { theme: 'plain' } },
  tables: { items: domainTable<string, Item>(itemSchema) },
})

/**
 * Boot one facility over a shared memory medium, optionally injected with a
 * fleet subject (the third constructor argument replaces `process.env`).
 */
async function facility(pool: MemoryMediaPool, subject?: string) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  const backend = new MemoryStorageBackend(pool)
  ctx.storage.backend.register('memory', backend)
  return new DomainFacility(ctx, { backend: 'memory', routes: {} }, subject === undefined ? {} : { [NAMESPACE_ENV]: subject })
}

describe('namespace derivation (UT-S35-04)', () => {
  it('UT-S35-04 derives deterministic pattern-valid subject-unique names and reserves the suffix shape', async () => {
    const start = Date.now()
    try {
      // Deterministic, subject-unique, pattern-valid.
      const a1 = namespaceUnitName('notes', 'alice')
      const a2 = namespaceUnitName('notes', 'alice')
      const b = namespaceUnitName('notes', 'bob')
      expect(a1).toBe(a2)
      expect(a1).not.toBe(b)
      expect(a1).toMatch(/^notes_u[0-9a-f]{16}$/)
      expect(a1).toMatch(UNIT_NAME_RE)
      // The reserved suffix shape fails loud in every mode.
      const reserved = `notes_u${'a'.repeat(16)}`
      try {
        assertNamespaceSafeUnitName(reserved)
        expect.unreachable('reserved name must fail loud')
      } catch (error) {
        expect(error).toBeInstanceOf(DomainError)
        expect((error as DomainError).code).toBe('reserved-unit-name')
      }
      // The subject comes from the environment; blank counts as absent.
      expect(resolveNamespaceSubject({ [NAMESPACE_ENV]: 'alice' })).toBe('alice')
      expect(resolveNamespaceSubject({ [NAMESPACE_ENV]: '  ' })).toBeUndefined()
      expect(resolveNamespaceSubject({})).toBeUndefined()
      reportResult('UT-S35-04', 'pass', undefined, Date.now() - start)
    } catch (error) {
      reportResult('UT-S35-04', 'fail', String(error), Date.now() - start)
      throw error
    }
  })
})

describe('namespace isolation over one shared medium', () => {
  it('UT-S35-01 keeps same-named keys independent across subjects', async () => {
    const start = Date.now()
    try {
      const pool = new MemoryMediaPool()
      const alice = await facility(pool, 'alice')
      const bob = await facility(pool, 'bob')
      const a = await alice.open(spec)
      const b = await bob.open(spec)
      await a.table('items').put('k', { label: 'from-alice' })
      expect(b.table('items').get('k')).toBeUndefined()
      await b.table('items').put('k', { label: 'from-bob' })
      expect(a.table('items').get('k')).toEqual({ label: 'from-alice' })
      expect(b.table('items').get('k')).toEqual({ label: 'from-bob' })
      await a.close()
      await b.close()
      reportResult('UT-S35-01', 'pass', undefined, Date.now() - start)
    } catch (error) {
      reportResult('UT-S35-01', 'fail', String(error), Date.now() - start)
      throw error
    }
  })

  it('UT-S35-05 separates the global slot per subject', async () => {
    const start = Date.now()
    try {
      const pool = new MemoryMediaPool()
      const alice = await facility(pool, 'alice')
      const bob = await facility(pool, 'bob')
      const a = await alice.open(spec)
      const b = await bob.open(spec)
      await a.global.set({ theme: 'dark' })
      expect(b.global.get()).toEqual({ theme: 'plain' })
      await b.global.set({ theme: 'light' })
      expect(a.global.get()).toEqual({ theme: 'dark' })
      await a.close()
      await b.close()
      reportResult('UT-S35-05', 'pass', undefined, Date.now() - start)
    } catch (error) {
      reportResult('UT-S35-05', 'fail', String(error), Date.now() - start)
      throw error
    }
  })

  it('UT-S35-03 keeps the domain keyspace closed across namespaces', async () => {
    const start = Date.now()
    try {
      const pool = new MemoryMediaPool()
      const alice = await facility(pool, 'alice')
      const bob = await facility(pool, 'bob')
      const a = await alice.open(spec)
      const b = await bob.open(spec)
      // Alice writes a key named after Bob's derived unit shape; it stays
      // inside Alice's namespace and never reaches Bob's data.
      await a.table('items').put(namespaceUnitName('notes', 'bob'), { label: 'spoof' })
      expect(b.table('items').get(namespaceUnitName('notes', 'bob'))).toBeUndefined()
      expect([...b.table('items').entries()].length).toBe(0)
      await a.close()
      await b.close()
      reportResult('UT-S35-03', 'pass', undefined, Date.now() - start)
    } catch (error) {
      reportResult('UT-S35-03', 'fail', String(error), Date.now() - start)
      throw error
    }
  })

  it('UT-S35-02 keeps the default namespace on plain names with no subject', async () => {
    const start = Date.now()
    try {
      const pool = new MemoryMediaPool()
      // Default and subject facilities share one medium; the default
      // facility's data lands under the plain unit name, disjoint from any
      // derived name.
      const single = await facility(pool)
      const alice = await facility(pool, 'alice')
      const s = await single.open(spec)
      const a = await alice.open(spec)
      await s.table('items').put('k', { label: 'plain' })
      expect(a.table('items').get('k')).toBeUndefined()
      expect(s.table('items').get('k')).toEqual({ label: 'plain' })
      await s.close()
      await a.close()
      reportResult('UT-S35-02', 'pass', undefined, Date.now() - start)
    } catch (error) {
      reportResult('UT-S35-02', 'fail', String(error), Date.now() - start)
      throw error
    }
  })
})
