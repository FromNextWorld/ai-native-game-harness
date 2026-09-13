// Only owns retry scheduling. Process creation and teardown remain in Desktop.
export function createRuntimeRecovery({ restart, isStopping, onRetry, onExhausted, onError = () => {}, delays = [1000, 2000, 4000], stableMs = 60_000 }) {
  let timer
  let stableTimer
  let running = false
  let stopped = false
  let attempts = 0
  let pendingFailure
  const cancelled = () => stopped || isStopping()
  const notify = (callback, ...args) => {
    try { callback?.(...args) } catch { /* reporting cannot create another crash */ }
  }

  function failed(error) {
    clearTimeout(stableTimer)
    if (cancelled() || timer !== undefined) return
    if (running) {
      pendingFailure = error
      return
    }
    if (attempts >= delays.length) {
      notify(onExhausted, error)
      return
    }
    const delay = delays[attempts++]
    notify(onRetry, attempts, delay, error)
    timer = setTimeout(async () => {
      timer = undefined
      if (cancelled()) return
      running = true
      pendingFailure = undefined
      try {
        await restart()
      } catch (failure) {
        pendingFailure = failure
        notify(onError, failure)
      } finally {
        running = false
        if (pendingFailure !== undefined) failed(pendingFailure)
      }
    }, delay)
  }

  return {
    failed,
    ready() {
      clearTimeout(stableTimer)
      if (cancelled()) return
      stableTimer = setTimeout(() => { attempts = 0 }, stableMs)
      stableTimer.unref?.()
    },
    stop() {
      stopped = true
      clearTimeout(timer)
      clearTimeout(stableTimer)
      timer = undefined
    },
  }
}
