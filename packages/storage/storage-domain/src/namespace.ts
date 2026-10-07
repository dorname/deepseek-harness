/**
 * Per-user namespace derivation for domain units: when the process runs under
 * a fleet deployment (the manager injects the authenticated subject into
 * `DSH_FLEET_USER_ID`), every domain unit opens under a subject-derived name
 * so several users share one storage medium without seeing each other's data.
 * Domain declarations, domain implementations, and KV backends are unaware of
 * namespaces; the derivation is the single seam between them.
 * @module @deepseek-ai/dsh-storage-domain/src/namespace
 */

import { createHash } from 'node:crypto'
import { UNIT_NAME_RE } from '@deepseek-ai/dsh-storage'
import { DomainError } from './error.ts'

/** Environment variable carrying the fleet subject (injected by the fleet manager). */
export const NAMESPACE_ENV = 'DSH_FLEET_USER_ID'

/**
 * Unit-name shape reserved by {@link namespaceUnitName}: `<unit>_u<16 hex>`.
 * Spec names ending in this shape are rejected in EVERY mode (default and
 * namespaced), so a default-namespace open can never alias a namespaced
 * unit on the same medium.
 */
const RESERVED_NAME = /_u[0-9a-f]{16}$/

/**
 * Read the fleet subject from the process environment.
 * @param env - Environment to read (defaults to `process.env`).
 * @returns the subject, or `undefined` when the process is not fleet-injected
 * (single-machine mode: domains open under their plain names).
 */
export function resolveNamespaceSubject(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const subject = env[NAMESPACE_ENV]?.trim()
  return subject === '' ? undefined : subject
}

/**
 * Reject spec names carrying the namespace-reserved suffix shape.
 * @param unit - Domain (unit) name from the spec.
 * @throws DomainError `reserved-unit-name` when the name ends in the shape
 * {@link namespaceUnitName} produces.
 */
export function assertNamespaceSafeUnitName(unit: string): void {
  if (RESERVED_NAME.test(unit)) {
    throw new DomainError(
      'reserved-unit-name',
      `domain '${unit}' ends with the namespace-reserved suffix shape '_u<64 hex>'; `
      + 'choose another name so default-namespace opens can never alias a namespaced unit',
    )
  }
}

/**
 * Derive the namespaced physical unit name for one subject:
 * `<unit>_u<sha256(subject) first 16 hex>`. Deterministic per
 * (unit, subject); different subjects derive different names for the same
 * unit, and the 64-bit digest keeps cross-namespace collisions practically
 * impossible at fleet scale (the remaining aliasing hazard is guarded by
 * {@link assertNamespaceSafeUnitName}). The digest is short on purpose: SQL
 * media truncate physical identifiers (63 bytes on PostgreSQL), so the
 * derived name must leave room for the record-table suffix. The result
 * always satisfies `UNIT_NAME_RE` because the digest is lowercase hex.
 * @param unit - Domain (unit) name from the spec (already `UNIT_NAME_RE`-valid).
 * @param subject - Fleet subject.
 * @returns the physical unit name to open.
 */
export function namespaceUnitName(unit: string, subject: string): string {
  const digest = createHash('sha256').update(subject, 'utf8').digest('hex').slice(0, 16)
  const derived = `${unit}_u${digest}`
  if (!UNIT_NAME_RE.test(derived)) {
    // Unreachable: `unit` is UNIT_NAME_RE-valid and the suffix is lowercase hex.
    throw new DomainError('reserved-unit-name', `derived namespace unit name '${derived}' violates ${UNIT_NAME_RE}`)
  }
  return derived
}
