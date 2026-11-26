// Background model-inventory watcher.
//
// SAIA adds and retires models over time. The plugin snapshots the inventory
// at startup behind a 24 h disk cache, so a long-running OpenCode server
// would otherwise not notice changes until a restart with an expired cache.
// This watcher re-checks on a long interval (default 24 h, override with
// SAIA_MODEL_CHECK_INTERVAL_MS, "0" disables) and reports the diff.

export interface ModelDiff {
  added: string[]
  removed: string[]
}

export const DEFAULT_MODEL_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

const INTERVAL_PATTERN = /^(\d+)(ms|s|m|h)?$/

export function diffModelIds(previous: readonly string[], next: readonly string[]): ModelDiff {
  const previousSet = new Set(previous)
  const nextSet = new Set(next)

  return {
    added: next.filter((id) => !previousSet.has(id)),
    removed: previous.filter((id) => !nextSet.has(id)),
  }
}

// Accepts milliseconds ("3600000") and human suffixes ("90m", "12h", "30s").
// Zero or negative values disable the watcher; junk falls back to the default.
export function modelCheckIntervalMs(
  environment: Record<string, string | undefined> = process.env,
): number {
  const raw = environment.SAIA_MODEL_CHECK_INTERVAL_MS?.trim()
  if (!raw) return DEFAULT_MODEL_CHECK_INTERVAL_MS

  const match = INTERVAL_PATTERN.exec(raw)
  if (!match) return DEFAULT_MODEL_CHECK_INTERVAL_MS

  const value = Number(match[1])
  const scale = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, undefined: 1 }[match[2] ?? "ms"] ?? 1
  return Math.max(0, value * scale)
}

export interface ModelWatcherHandle {
  stop(): void
  checkNow(): Promise<void>
}

export interface ModelWatcherOptions {
  // Inventory as of the last successful load; the first check compares against it.
  knownIds: readonly string[]
  // Fetches the current inventory; a forced refresh upstream is expected.
  check: () => Promise<readonly string[]>
  onChange: (diff: ModelDiff) => void | Promise<void>
  onError?: (error: unknown) => void
  intervalMs?: number
  // Test seam; defaults to the global timer functions.
  timers?: {
    setInterval: (callback: () => void, ms: number) => unknown
    clearInterval: (handle: unknown) => void
  }
}

export function createModelWatcher({
  knownIds,
  check,
  onChange,
  onError,
  intervalMs = DEFAULT_MODEL_CHECK_INTERVAL_MS,
  timers,
}: ModelWatcherOptions): ModelWatcherHandle {
  let currentIds = [...knownIds]

  if (!intervalMs || intervalMs <= 0) {
    return { stop() {}, async checkNow() {} }
  }

  const schedule = timers?.setInterval ?? ((callback: () => void, ms: number) => globalThis.setInterval(callback, ms))
  const cancel = timers?.clearInterval ?? ((handle: unknown) => globalThis.clearInterval(handle as NodeJS.Timeout))

  let running = false
  const runCheck = async () => {
    if (running) return
    running = true
    try {
      const ids = await check()
      const diff = diffModelIds(currentIds, ids)
      if (diff.added.length > 0 || diff.removed.length > 0) {
        await onChange(diff)
      }
      currentIds = [...ids]
    } catch (error) {
      onError?.(error)
    } finally {
      running = false
    }
  }

  const handle = schedule(() => void runCheck(), intervalMs)
  // A model check must never keep the OpenCode server process alive.
  if (handle && typeof (handle as { unref?: () => void }).unref === "function") {
    ;(handle as { unref: () => void }).unref()
  }

  return {
    stop() {
      cancel(handle)
    },
    checkNow: runCheck,
  }
}
