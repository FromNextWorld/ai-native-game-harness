import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRuntimeRecovery } from '../../apps/desktop/src/runtime-recovery.mjs'

afterEach(() => vi.useRealTimers())

describe('Desktop Runtime recovery', () => {
  it('deduplicates exits and exhausts repeated startup failures with bounded backoff', async () => {
    vi.useFakeTimers()
    const restart = vi.fn(async () => { throw new Error('startup failed') })
    const exhausted = vi.fn()
    const recovery = createRuntimeRecovery({ restart, isStopping: () => false, onExhausted: exhausted })
    recovery.failed(new Error('exit'))
    recovery.failed(new Error('duplicate exit'))
    await vi.advanceTimersByTimeAsync(999)
    expect(restart).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(restart).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2000)
    expect(restart).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(4000)
    expect(restart).toHaveBeenCalledTimes(3)
    expect(exhausted).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(restart).toHaveBeenCalledTimes(3)
    recovery.stop()
  })

  it('never restarts after quitting and does not overlap an in-flight restart', async () => {
    vi.useFakeTimers()
    let finish!: () => void
    const restart = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
    const recovery = createRuntimeRecovery({ restart, isStopping: () => false })
    recovery.failed(new Error('exit'))
    await vi.advanceTimersByTimeAsync(1000)
    recovery.failed(new Error('exit during restart'))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(restart).toHaveBeenCalledOnce()
    recovery.stop()
    finish()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(restart).toHaveBeenCalledOnce()
  })

  it('replenishes the retry budget only after a stable running interval', async () => {
    vi.useFakeTimers()
    const restart = vi.fn(async () => { recovery.ready() })
    const recovery = createRuntimeRecovery({ restart, isStopping: () => false, delays: [1000] })
    recovery.failed(new Error('exit'))
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(60_000)
    recovery.failed(new Error('new exit after stable service'))
    await vi.advanceTimersByTimeAsync(1000)
    expect(restart).toHaveBeenCalledTimes(2)
    recovery.stop()
  })
})
