/** A lease coordinates game connections; it never deletes durable session data. */
export interface SessionLease<T> {
  readonly value: T
  current(): boolean
  release(): Promise<void>
}

interface Entry<T> {
  owner: object
  value: T
  close(): Promise<void>
  revoke(): void
  active: boolean
  lease: SessionLease<T>
}

export class SessionOwnership<T> {
  private readonly entries = new Map<string, Entry<T>>()
  private readonly tails = new Map<string, Promise<unknown>>()

  private async exclusive<R>(id: string, operation: () => Promise<R>): Promise<R> {
    const prior = this.tails.get(id)
    const next = (async () => { await prior?.catch(() => undefined); return await operation() })()
    this.tails.set(id, next)
    try { return await next } finally { if (this.tails.get(id) === next) this.tails.delete(id) }
  }

  async acquire(id: string, owner: object, signal: AbortSignal,
    open: () => Promise<{ value: T, close(): Promise<void> }>, revoke: () => void,
  ): Promise<SessionLease<T>> {
    return await this.exclusive(id, async () => {
      signal.throwIfAborted()
      const old = this.entries.get(id)
      if (old?.owner === owner && old.active) return old.lease
      if (old !== undefined) {
        old.active = false
        old.revoke()
        // Failed cleanup stays registered: never overwrite an unreleased owner.
        await old.close()
        this.entries.delete(id)
      }
      signal.throwIfAborted()
      const opened = await open()
      const entry: Entry<T> = {
        owner, ...opened, revoke, active: true,
        lease: {
          value: opened.value,
          current: () => entry.active && this.entries.get(id) === entry,
          release: () => this.exclusive(id, async () => {
            if (this.entries.get(id) !== entry) return
            entry.active = false
            await entry.close()
            this.entries.delete(id)
          }),
        },
      }
      this.entries.set(id, entry)
      if (signal.aborted) {
        entry.active = false
        await entry.close()
        this.entries.delete(id)
        signal.throwIfAborted()
      }
      return entry.lease
    })
  }
}

// Installed/profile module copies must agree on the owner within one Cordis root.
const registryKey = Symbol.for('ai-native-game-harness.game-session-ownership.v1')
export function sessionOwnership<T>(root: object): SessionOwnership<T> {
  const global = globalThis as typeof globalThis & { [registryKey]?: WeakMap<object, SessionOwnership<unknown>> }
  const roots = global[registryKey] ??= new WeakMap()
  let registry = roots.get(root)
  if (registry === undefined) { registry = new SessionOwnership(); roots.set(root, registry) }
  return registry as SessionOwnership<T>
}

export function isMissingSession(error: unknown, sessionId: string): boolean {
  // The installed DSH persistence API uses this exact identity-bound failure.
  // Network/auth/corruption/setup errors must never fall through to a new Session.
  return error instanceof Error && error.message === `session "${sessionId}" not found`
}

export async function waitForSessionIdle(work: Promise<void>, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  let onAbort!: () => void
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try { await Promise.race([work, cancelled]) }
  finally { signal.removeEventListener('abort', onAbort) }
}
