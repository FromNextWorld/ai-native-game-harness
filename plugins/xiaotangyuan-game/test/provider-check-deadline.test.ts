import { afterEach, describe, expect, it, vi } from 'vitest'
import { withProviderCheckDeadline } from '../src/runtime/speech/provider-check-deadline.js'

afterEach(() => vi.useRealTimers())
describe('speech configuration deadline', () => {
  it('returns a configured result and clears its timer', async () => {
    vi.useFakeTimers()
    await expect(withProviderCheckDeadline(async () => 'configured', new AbortController().signal)).resolves.toBe('configured')
    expect(vi.getTimerCount()).toBe(0)
  })
  it('times out a non-cooperating provider and consumes its late rejection', async () => {
    vi.useFakeTimers()
    const pending = Promise.withResolvers<string>()
    const check = withProviderCheckDeadline(() => pending.promise, new AbortController().signal)
    const assertion = expect(check).rejects.toMatchObject({ code: 'SPEECH_CONFIG_TIMEOUT' })
    await vi.advanceTimersByTimeAsync(5_000)
    await assertion
    pending.reject(new Error('late failure'))
    await Promise.resolve()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('cancels waiting on close without requiring the provider to settle', async () => {
    vi.useFakeTimers()
    const abort = new AbortController()
    const check = withProviderCheckDeadline(() => new Promise(() => {}), abort.signal)
    const assertion = expect(check).rejects.toThrow('closed')
    abort.abort(new Error('closed'))
    await assertion
    expect(vi.getTimerCount()).toBe(0)
  })
  it('does not invoke the provider when already closed', async () => {
    const check = vi.fn(async () => true)
    await expect(withProviderCheckDeadline(check, AbortSignal.abort(new Error('closed')))).rejects.toThrow('closed')
    expect(check).not.toHaveBeenCalled()
  })
})
