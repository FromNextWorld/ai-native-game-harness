/** Bound even legacy providers that do not support cancellation themselves. */
export function withProviderCheckDeadline<T>(check: () => Promise<T>, signal: AbortSignal, timeoutMs = 5_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return }
    let settled = false
    const finish = (error: unknown, value?: T, failed = false): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', aborted)
      if (failed) reject(error)
      else resolve(value as T)
    }
    const aborted = (): void => finish(signal.reason, undefined, true)
    const timer = setTimeout(() => finish(Object.assign(new Error('语音配置检查超时，请稍后重试。'), { code: 'SPEECH_CONFIG_TIMEOUT' }), undefined, true), timeoutMs)
    timer.unref()
    signal.addEventListener('abort', aborted, { once: true })
    Promise.resolve().then(() => {
      signal.throwIfAborted()
      return check()
    }).then(value => finish(undefined, value), error => finish(error, undefined, true))
  })
}
