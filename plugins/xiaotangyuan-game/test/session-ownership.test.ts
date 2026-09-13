import { describe, expect, it, vi } from 'vitest'
import { SessionOwnership, isMissingSession } from '../src/runtime/agent/session-ownership.js'

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

describe('game Session ownership', () => {
  it('single-flights concurrent acquisition by the same owner', async () => {
    const registry = new SessionOwnership<number>()
    const ready = deferred()
    const owner = {}
    const open = vi.fn(async () => { await ready.promise; return { value: 1, close: vi.fn() } })
    const first = registry.acquire('save', owner, new AbortController().signal, open, vi.fn())
    const second = registry.acquire('save', owner, new AbortController().signal, open, vi.fn())
    ready.resolve()
    expect(await first).toBe(await second)
    expect(open).toHaveBeenCalledOnce()
    await (await first).release()
  })

  it('drains the old owner before opening the new one; late old release is harmless', async () => {
    const registry = new SessionOwnership<number>()
    const drain = deferred()
    const revoke = vi.fn()
    const old = await registry.acquire('save', {}, new AbortController().signal,
      async () => ({ value: 1, close: async () => { await drain.promise } }), revoke)
    const closeNew = vi.fn(async () => undefined)
    const open = vi.fn(async () => ({ value: 2, close: closeNew }))
    const acquiring = registry.acquire('save', {}, new AbortController().signal, open, vi.fn())
    await vi.waitFor(() => expect(revoke).toHaveBeenCalledOnce())
    expect(old.current()).toBe(false)
    expect(open).not.toHaveBeenCalled()
    drain.resolve()
    const next = await acquiring
    await old.release()
    expect(next.current()).toBe(true)
    expect(closeNew).not.toHaveBeenCalled()
    await next.release()
  })

  it('rolls back a handle whose connection closed during asynchronous initialization', async () => {
    const registry = new SessionOwnership<number>()
    const ready = deferred()
    const started = deferred()
    const abort = new AbortController()
    const close = vi.fn(async () => undefined)
    const acquiring = registry.acquire('save', {}, abort.signal, async () => {
      started.resolve(); await ready.promise; return { value: 1, close }
    }, vi.fn())
    const rejected = expect(acquiring).rejects.toThrow('closed')
    await started.promise
    abort.abort(new Error('closed'))
    ready.resolve()
    await rejected
    expect(close).toHaveBeenCalledOnce()
    const replacement = await registry.acquire('save', {}, new AbortController().signal, async () => ({ value: 2, close: async () => undefined }), vi.fn())
    expect(replacement.value).toBe(2)
    await replacement.release()
  })

  it('keeps a failed teardown fenced instead of creating a second live owner', async () => {
    const registry = new SessionOwnership<number>()
    const close = vi.fn(async () => { throw new Error('flush failed') })
    const old = await registry.acquire('save', {}, new AbortController().signal, async () => ({ value: 1, close }), vi.fn())
    const open = vi.fn(async () => ({ value: 2, close: async () => undefined }))
    await expect(old.release()).rejects.toThrow('flush failed')
    await expect(registry.acquire('save', {}, new AbortController().signal, open, vi.fn())).rejects.toThrow('flush failed')
    expect(open).not.toHaveBeenCalled()
  })

  it('does not block another save behind a slow initialization', async () => {
    const registry = new SessionOwnership<number>()
    const slow = deferred()
    const first = registry.acquire('a', {}, new AbortController().signal, async () => { await slow.promise; return { value: 1, close: async () => undefined } }, vi.fn())
    const second = await registry.acquire('b', {}, new AbortController().signal, async () => ({ value: 2, close: async () => undefined }), vi.fn())
    expect(second.value).toBe(2)
    slow.resolve()
    await (await first).release(); await second.release()
  })

  it('does not treat generic persistence failures as missing history', () => {
    expect(isMissingSession(new Error('session "save" not found'), 'save')).toBe(true)
    for (const message of ['fetch failed', 'unauthorized', 'corrupt session', 'session "other" not found']) {
      expect(isMissingSession(new Error(message), 'save')).toBe(false)
    }
  })
})
