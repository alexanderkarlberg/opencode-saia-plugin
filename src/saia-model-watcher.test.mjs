import assert from "node:assert/strict"
import test from "node:test"
import {
  DEFAULT_MODEL_CHECK_INTERVAL_MS,
  createModelWatcher,
  diffModelIds,
  modelCheckIntervalMs,
} from "./saia-model-watcher.ts"

function fakeTimers() {
  const ticks = []
  const handles = []
  const unrefed = []
  return {
    ticks,
    unrefed,
    setInterval(callback, ms) {
      const handle = { callback, ms }
      handles.push(handle)
      return handle
    },
    clearInterval(handle) {
      const index = handles.indexOf(handle)
      if (index >= 0) handles.splice(index, 1)
    },
    fire(index = 0) {
      assert.ok(handles[index], "no scheduled interval")
      handles[index].callback()
    },
    get scheduled() {
      return handles.length
    },
    get scheduledMs() {
      return handles[0]?.ms
    },
  }
}

// Marks fake handles as unref-able so the watcher exercises that path.
function unrefableFakeTimers() {
  const timers = fakeTimers()
  const original = timers.setInterval
  timers.setInterval = (callback, ms) => {
    const handle = original(callback, ms)
    handle.unref = () => timers.unrefed.push(handle)
    return handle
  }
  return timers
}

test("diffModelIds reports additions and removals independently", () => {
  assert.deepEqual(diffModelIds(["a", "b"], ["b", "c"]), { added: ["c"], removed: ["a"] })
  assert.deepEqual(diffModelIds(["a"], ["a"]), { added: [], removed: [] })
  assert.deepEqual(diffModelIds([], ["a"]), { added: ["a"], removed: [] })
  assert.deepEqual(diffModelIds(["a"], []), { added: [], removed: ["a"] })
})

test("modelCheckIntervalMs defaults to 24h and parses overrides", () => {
  assert.equal(modelCheckIntervalMs({}), DEFAULT_MODEL_CHECK_INTERVAL_MS)
  assert.equal(modelCheckIntervalMs({ SAIA_MODEL_CHECK_INTERVAL_MS: "" }), DEFAULT_MODEL_CHECK_INTERVAL_MS)
  assert.equal(modelCheckIntervalMs({ SAIA_MODEL_CHECK_INTERVAL_MS: "  " }), DEFAULT_MODEL_CHECK_INTERVAL_MS)
  assert.equal(modelCheckIntervalMs({ SAIA_MODEL_CHECK_INTERVAL_MS: "junk" }), DEFAULT_MODEL_CHECK_INTERVAL_MS)

  assert.equal(modelCheckIntervalMs({ SAIA_MODEL_CHECK_INTERVAL_MS: "3600000" }), 3_600_000)
  assert.equal(modelCheckIntervalMs({ SAIA_MODEL_CHECK_INTERVAL_MS: "30s" }), 30_000)
  assert.equal(modelCheckIntervalMs({ SAIA_MODEL_CHECK_INTERVAL_MS: "15m" }), 900_000)
  assert.equal(modelCheckIntervalMs({ SAIA_MODEL_CHECK_INTERVAL_MS: "12h" }), 12 * 3_600_000)
  assert.equal(modelCheckIntervalMs({ SAIA_MODEL_CHECK_INTERVAL_MS: "0" }), 0, "0 disables the watcher")
  assert.equal(
    modelCheckIntervalMs({ SAIA_MODEL_CHECK_INTERVAL_MS: "-5" }),
    DEFAULT_MODEL_CHECK_INTERVAL_MS,
    "negative junk falls back to the default",
  )
})

test("watcher reports the diff when the inventory changes", async () => {
  const timers = fakeTimers()
  const changes = []
  let inventory = ["a", "b"]

  const watcher = createModelWatcher({
    knownIds: ["a", "b"],
    check: async () => inventory,
    onChange: async (diff) => changes.push(diff),
    intervalMs: 1_000,
    timers,
  })

  assert.equal(timers.scheduled, 1)
  assert.equal(timers.scheduledMs, 1_000)

  timers.fire()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(changes, [], "an unchanged inventory reports nothing")

  inventory = ["a", "c"]
  timers.fire()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(changes, [{ added: ["c"], removed: ["b"] }])

  inventory = ["a", "c"]
  timers.fire()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(changes.length, 1, "repeat checks without change stay quiet")

  watcher.stop()
  assert.equal(timers.scheduled, 0)
})

test("watcher keeps running after a failed check", async () => {
  const timers = fakeTimers()
  const changes = []
  const errors = []
  let shouldFail = true

  const watcher = createModelWatcher({
    knownIds: ["a"],
    check: async () => {
      if (shouldFail) throw new Error("network down")
      return ["a", "b"]
    },
    onChange: (diff) => changes.push(diff),
    onError: (error) => errors.push(error),
    intervalMs: 1_000,
    timers,
  })

  timers.fire()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(errors.length, 1)
  assert.deepEqual(changes, [])

  shouldFail = false
  timers.fire()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(changes, [{ added: ["b"], removed: [] }])

  watcher.stop()
})

test("watcher does not schedule anything when disabled", async () => {
  const timers = fakeTimers()
  const watcher = createModelWatcher({
    knownIds: ["a"],
    check: async () => ["a"],
    onChange: () => assert.fail("must not fire"),
    intervalMs: 0,
    timers,
  })

  assert.equal(timers.scheduled, 0)
  await watcher.checkNow()
  watcher.stop()
})

test("watcher never keeps the process alive", () => {
  const timers = unrefableFakeTimers()
  const watcher = createModelWatcher({
    knownIds: ["a"],
    check: async () => ["a"],
    onChange: () => {},
    intervalMs: 1_000,
    timers,
  })

  assert.equal(timers.unrefed.length, 1, "the interval handle must be unref'd")
  watcher.stop()
})

test("overlapping ticks collapse into one check", async () => {
  const timers = fakeTimers()
  let checks = 0
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })

  const watcher = createModelWatcher({
    knownIds: ["a"],
    check: () => {
      checks += 1
      return gate.then(() => ["a"])
    },
    onChange: () => {},
    intervalMs: 1_000,
    timers,
  })

  timers.fire()
  timers.fire()
  timers.fire()
  assert.equal(checks, 1, "a running check absorbs further ticks")
  release()
  await watcher.checkNow()
  assert.equal(checks, 1)
  watcher.stop()
})
