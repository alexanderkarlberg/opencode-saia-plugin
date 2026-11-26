import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import {
  createDemandTracker,
  demandLevel,
  extractDemandIndex,
  formatDemand,
} from "./saia-demand.ts"

const MODELS_PAYLOAD = {
  data: [
    { id: "glm-5.3-flash", name: "GLM 5.3 Flash", status: "ready", demand: 2 },
    { id: "qwen3.5-397b-a17b", name: "Qwen 3.5 397B", status: "ready", demand: 9 },
    { id: "meta-llama-3.1-8b-instruct", status: "loading", demand: 0 },
    { id: "broken-model", status: "ready" },
    { status: "ready", demand: 1 },
  ],
}

test("demandLevel mirrors the Chat AI web UI thresholds", () => {
  assert.equal(demandLevel(0), "low")
  assert.equal(demandLevel(1), "low")
  assert.equal(demandLevel(2), "medium")
  assert.equal(demandLevel(3), "medium")
  assert.equal(demandLevel(4), "high")
  assert.equal(demandLevel(5), "high")
  assert.equal(demandLevel(6), "very high")
  assert.equal(demandLevel("4"), "high")
  assert.equal(demandLevel(undefined), undefined)
  assert.equal(demandLevel("busy"), undefined)
})

test("formatDemand renders the load label", () => {
  assert.equal(formatDemand({ demand: 2, status: "ready" }), "load: medium")
  assert.equal(formatDemand({ demand: 9, status: "ready" }), "load: very high")
  assert.equal(formatDemand({ demand: null, status: "loading" }), "load: loading")
  assert.equal(formatDemand({ demand: 3, status: "offline" }), "load: offline")
  assert.equal(formatDemand({ demand: null, status: "ready" }), "")
  assert.equal(formatDemand(undefined), "")
})

test("extractDemandIndex keeps only load fields, keyed by model id", () => {
  assert.deepEqual(extractDemandIndex(MODELS_PAYLOAD), {
    "glm-5.3-flash": { demand: 2, status: "ready" },
    "qwen3.5-397b-a17b": { demand: 9, status: "ready" },
    "meta-llama-3.1-8b-instruct": { demand: 0, status: "loading" },
    "broken-model": { demand: null, status: "ready" },
  })
  assert.deepEqual(extractDemandIndex({}), {})
  assert.deepEqual(extractDemandIndex(null), {})
  assert.deepEqual(extractDemandIndex({ data: "nope" }), {})
})

async function tempCacheFile(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "saia-demand-"))
  t.after(() => import("node:fs/promises").then((fs) => fs.rm(dir, { recursive: true, force: true })))
  return path.join(dir, "demand.json")
}

function trackerWith(t, { payload = MODELS_PAYLOAD, fetchImpl, ttlMs = 60_000, resolveApiKey } = {}) {
  const calls = []
  const fetch =
    fetchImpl ??
    (async (url, init) => {
      calls.push({ url, init })
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    })
  const tracker = createDemandTracker({
    fetchImpl: fetch,
    resolveApiKey: resolveApiKey ?? (async () => "test-key"),
    cacheFile: t.cacheFile,
    ttlMs,
  })
  return { tracker, calls }
}

test("fetches /v1/models with the API key and serves demand per model", async (t) => {
  t.cacheFile = await tempCacheFile(t)
  const { tracker, calls } = trackerWith(t)

  assert.deepEqual(await tracker.getDemand("glm-5.3-flash"), { demand: 2, status: "ready" })
  assert.equal(await tracker.getDemand("unknown-model"), undefined)
  assert.equal(await tracker.getDemand(""), undefined)
  assert.equal(await tracker.getDemand(undefined), undefined)

  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, "https://chat-ai.academiccloud.de/v1/models")
  assert.equal(calls[0].init.headers.Authorization, "Bearer test-key")
})

test("serves repeat lookups from the in-memory snapshot within the TTL", async (t) => {
  t.cacheFile = await tempCacheFile(t)
  const { tracker, calls } = trackerWith(t)

  await tracker.getDemand("glm-5.3-flash")
  await tracker.getDemand("qwen3.5-397b-a17b")
  await tracker.getIndex()

  assert.equal(calls.length, 1)
})

test("dedupes concurrent refreshes into a single fetch", async (t) => {
  t.cacheFile = await tempCacheFile(t)
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const { tracker, calls } = trackerWith(t, {
    fetchImpl: async (url, init) => {
      calls.push({ url, init })
      await gate
      return new Response(JSON.stringify(MODELS_PAYLOAD))
    },
  })

  const pending = Promise.all([
    tracker.getDemand("glm-5.3-flash"),
    tracker.getDemand("qwen3.5-397b-a17b"),
  ])
  release()
  const [a, b] = await pending

  assert.equal(calls.length, 1)
  assert.deepEqual(a, { demand: 2, status: "ready" })
  assert.deepEqual(b, { demand: 9, status: "ready" })
})

test("persists the snapshot to disk and reuses it within the TTL", async (t) => {
  t.cacheFile = await tempCacheFile(t)
  await mkdir(path.dirname(t.cacheFile), { recursive: true })
  await writeFile(
    t.cacheFile,
    JSON.stringify({ index: { "glm-5.3-flash": { demand: 1, status: "ready" } }, timestamp: Date.now() }),
  )

  const { tracker, calls } = trackerWith(t)
  assert.deepEqual(await tracker.getDemand("glm-5.3-flash"), { demand: 1, status: "ready" })
  assert.equal(calls.length, 0, "fresh disk cache must not trigger a fetch")
})

test("refreshes once the TTL expires and writes the new snapshot back", async (t) => {
  t.cacheFile = await tempCacheFile(t)
  await mkdir(path.dirname(t.cacheFile), { recursive: true })
  await writeFile(
    t.cacheFile,
    JSON.stringify({ index: { "glm-5.3-flash": { demand: 1, status: "ready" } }, timestamp: Date.now() - 120_000 }),
  )

  const { tracker, calls } = trackerWith(t, { ttlMs: 60_000 })
  assert.deepEqual(await tracker.getDemand("glm-5.3-flash"), { demand: 2, status: "ready" })
  assert.equal(calls.length, 1)

  const persisted = JSON.parse(await readFile(t.cacheFile, "utf8"))
  assert.deepEqual(persisted.index["qwen3.5-397b-a17b"], { demand: 9, status: "ready" })
})

test("falls back to the stale disk snapshot when the fetch fails", async (t) => {
  t.cacheFile = await tempCacheFile(t)
  await mkdir(path.dirname(t.cacheFile), { recursive: true })
  await writeFile(
    t.cacheFile,
    JSON.stringify({ index: { "glm-5.3-flash": { demand: 7, status: "ready" } }, timestamp: Date.now() - 3_600_000 }),
  )

  const warnings = []
  const tracker = createDemandTracker({
    fetchImpl: async () => new Response("boom", { status: 500, statusText: "Server Error" }),
    resolveApiKey: async () => "test-key",
    cacheFile: t.cacheFile,
    ttlMs: 60_000,
    onWarning: (message) => warnings.push(message),
  })

  assert.deepEqual(await tracker.getDemand("glm-5.3-flash"), { demand: 7, status: "ready" })
  assert.equal(warnings.length, 0, "a stale snapshot is served without warning")
})

test("warns and returns undefined when nothing is cached and the fetch fails", async (t) => {
  t.cacheFile = await tempCacheFile(t)
  const warnings = []
  const tracker = createDemandTracker({
    fetchImpl: async () => {
      throw new Error("network down")
    },
    resolveApiKey: async () => "test-key",
    cacheFile: t.cacheFile,
    onWarning: (message) => warnings.push(message),
  })

  assert.equal(await tracker.getDemand("glm-5.3-flash"), undefined)
  assert.deepEqual(warnings, ["[SAIA] Failed to fetch model load: network down"])
})

test("fails cleanly when no API key is available", async (t) => {
  t.cacheFile = await tempCacheFile(t)
  const warnings = []
  const { tracker, calls } = trackerWith(t, {
    resolveApiKey: async () => undefined,
  })
  tracker.constructor // no-op to keep shape explicit
  const failing = createDemandTracker({
    fetchImpl: async () => {
      calls.push({})
      return new Response("{}")
    },
    resolveApiKey: async () => undefined,
    cacheFile: t.cacheFile,
    onWarning: (message) => warnings.push(message),
  })

  assert.equal(await failing.getDemand("glm-5.3-flash"), undefined)
  assert.equal(calls.length, 0, "the endpoint must not be called without a key")
  assert.match(warnings[0], /no SAIA API key/)
})
