/**
 * One opened PostgreSQL KV unit: per-table statement helpers over the
 * `u_<unit>_<table>` record tables plus this unit's row in the shared
 * `unit_globals` table. Each primitive is a single statement, so atomicity
 * comes from PostgreSQL itself — no explicit write queue (write ordering is
 * the caller's responsibility per the KV contract).
 * @module @deepseek-ai/dsh-storage-postgres/unit
 */

import type { Sql } from 'postgres'
import { StorageError } from '@deepseek-ai/dsh-storage'
import type { KvUnit, KvUnitDescriptor } from '@deepseek-ai/dsh-storage'
import { GLOBAL_TABLE, recordTableName } from './schema.ts'

/**
 * The PostgreSQL {@link KvUnit}. Constructed by the backend AFTER the unit's
 * version stamp and record tables exist. Values are stored as JSON text in
 * the `value` column.
 */
export class PostgresKvUnit implements KvUnit {
  private readonly tables: ReadonlySet<string>
  private closed = false

  /**
   * @param sql - Connected handle owned by the backend (never closed here).
   * @param descriptor - Validated descriptor whose record tables already exist.
   * @param onClose - Backend callback releasing this unit's open-name slot.
   */
  constructor(
    private readonly sql: Sql,
    private readonly descriptor: KvUnitDescriptor,
    private readonly onClose: () => void,
  ) {
    this.tables = new Set(descriptor.tables)
  }

  async loadAll(): Promise<{ tables: Record<string, Record<string, unknown>>; global: unknown }> {
    this.ensureOpen()
    const tables: Record<string, Record<string, unknown>> = {}
    for (const name of this.tables) {
      // The table name passed UNIT_NAME_RE validation, so the identifier is
      // safe to interpolate into statement text.
      const rows = await this.sql.unsafe(
        `SELECT key, value FROM "${recordTableName(this.descriptor.name, name)}"`,
      ) as Array<{ key: string; value: string }>
      // Null prototype: record keys are arbitrary strings, so '__proto__'
      // must land as an own property instead of mutating the prototype.
      const records: Record<string, unknown> = Object.create(null) as Record<string, unknown>
      for (const row of rows) {
        records[row.key] = this.parseValue(row.value, `table '${name}' key '${row.key}'`)
      }
      tables[name] = records
    }
    let global: unknown = null
    if (this.descriptor.hasGlobal) {
      const rows = await this.sql.unsafe(
        `SELECT value FROM "${GLOBAL_TABLE}" WHERE unit = $1`,
        [this.descriptor.name],
      ) as Array<{ value: string }>
      const row = rows[0]
      if (row !== undefined) global = this.parseValue(row.value, 'global slot')
    }
    return { tables, global }
  }

  /** Parse one stored value column, mapping bad JSON to `malformed-medium`. */
  private parseValue(text: string, slot: string): unknown {
    try {
      return JSON.parse(text)
    } catch (error) {
      throw new StorageError(
        'malformed-medium',
        `kv unit '${this.descriptor.name}' holds unparsable JSON at ${slot}`,
        { cause: error },
      )
    }
  }

  async putRecord(table: string, key: string, value: unknown): Promise<void> {
    this.ensureOpen()
    this.requireTable(table)
    let text: string
    try {
      text = JSON.stringify(value)
    } catch (error) {
      // A value's own toJSON throw is the only way stringify rejects here.
      throw new Error(`kv unit '${this.descriptor.name}' cannot serialize record '${key}': ${String(error)}`)
    }
    await this.sql.unsafe(
      `INSERT INTO "${recordTableName(this.descriptor.name, table)}" (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      [key, text],
    )
  }

  async deleteRecord(table: string, key: string): Promise<void> {
    this.ensureOpen()
    this.requireTable(table)
    await this.sql.unsafe(
      `DELETE FROM "${recordTableName(this.descriptor.name, table)}" WHERE key = $1`,
      [key],
    )
  }

  async setGlobal(value: unknown): Promise<void> {
    this.ensureOpen()
    if (!this.descriptor.hasGlobal) {
      throw new Error(`kv unit '${this.descriptor.name}' declared no global slot`)
    }
    let text: string
    try {
      text = JSON.stringify(value)
    } catch (error) {
      throw new Error(`kv unit '${this.descriptor.name}' cannot serialize the global slot: ${String(error)}`)
    }
    await this.sql.unsafe(
      `INSERT INTO "${GLOBAL_TABLE}" (unit, value) VALUES ($1, $2)
       ON CONFLICT (unit) DO UPDATE SET value = excluded.value`,
      [this.descriptor.name, text],
    )
  }

  close(): Promise<void> {
    if (!this.closed) {
      this.closed = true
      this.onClose()
    }
    return Promise.resolve()
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new StorageError('closed', `kv unit '${this.descriptor.name}' is closed`)
    }
  }

  private requireTable(table: string): void {
    if (!this.tables.has(table)) {
      throw new Error(`kv unit '${this.descriptor.name}' declared no table '${table}'`)
    }
  }
}
