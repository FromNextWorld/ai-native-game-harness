import { existsSync, mkdirSync, renameSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { reportRuntimeError } from '../error-diagnostics.js'

/** Full table/index validation. Never repair or recreate the live database here. */
export function assertMemoryIntegrity(db: DatabaseSync): void {
  const rows = db.prepare('PRAGMA integrity_check(20)').all()
  const messages = rows.map(row => String(Object.values(row)[0]))
  if (messages.length !== 1 || messages[0] !== 'ok') {
    throw Object.assign(new Error(`Memory database integrity check failed: ${messages.join('; ')}`), { code: 'MEMORY_DATABASE_CORRUPT' })
  }
}

export function checkExistingMemory(path: string): void {
  if (!existsSync(path)) return
  const db = new DatabaseSync(path, { readOnly: true })
  try { assertMemoryIntegrity(db) } finally { db.close() }
}

/** SQLite creates one consistent snapshot, including committed WAL contents. */
export function backupMemory(db: DatabaseSync, databasePath: string): string {
  assertMemoryIntegrity(db)
  const directory = join(dirname(databasePath), 'memory-backups')
  mkdirSync(directory, { recursive: true })
  const path = join(directory, `memory-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}.sqlite`)
  const pending = path + '.pending'
  db.prepare('VACUUM INTO ?').run(pending)
  checkExistingMemory(pending)
  renameSync(pending, path)
  return path
}

export function tryBackupMemory(db: DatabaseSync, databasePath: string): void {
  try { backupMemory(db, databasePath) }
  catch (error) {
    // A failed backup must be visible, but is not evidence the live store is broken.
    reportRuntimeError(error, { stage: 'memory.backup', source: 'memory-store', recovered: false })
  }
}
