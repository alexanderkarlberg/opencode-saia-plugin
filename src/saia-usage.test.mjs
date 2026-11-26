import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { countUsageToday, logSaiaRequest } from "./saia-usage.mjs"

async function tempUsageFile(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "saia-usage-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return path.join(dir, "usage.jsonl")
}

test("logSaiaRequest appends one JSONL entry with the ledger fields", async (t) => {
  const usageFile = await tempUsageFile(t)

  await logSaiaRequest({ modelId: "glm-5.3-flash", sessionID: "ses_1", status: 200, latencyMs: 1234 }, { usageFile })
  await logSaiaRequest({ modelId: null, sessionID: "ses_2", status: 429 }, { usageFile })

  const lines = (await readFile(usageFile, "utf8")).trim().split("\n").map((line) => JSON.parse(line))
  assert.equal(lines.length, 2)

  const [first, second] = lines
  assert.equal(first.modelId, "glm-5.3-flash")
  assert.equal(first.sessionID, "ses_1")
  assert.equal(first.status, 200)
  assert.equal(first.latencyMs, 1234)
  assert.equal(first.projectRoot, process.cwd())
  assert.match(first.timestamp, /^\d{4}-\d{2}-\d{2}T/)

  // Non-2xx responses and unknown models are ledgered too — they still
  // count against the request quota.
  assert.equal(second.status, 429)
  assert.equal(second.modelId, null)
  assert.equal(second.latencyMs, null)
})

test("logSaiaRequest never throws, even for an unwritable path", async () => {
  await logSaiaRequest({ modelId: "x" }, { usageFile: "/definitely/not/a/dir/usage.jsonl" })
})

test("countUsageToday counts only today's entries and returns null without a ledger", async (t) => {
  const usageFile = await tempUsageFile(t)
  const now = new Date("2026-11-26T15:00:00")

  assert.equal(await countUsageToday({ usageFile, now }), null, "missing ledger → null, not 0")

  await logSaiaRequest({ modelId: "a" }, { usageFile })
  await logSaiaRequest({ modelId: "b" }, { usageFile })
  assert.equal(await countUsageToday({ usageFile, now }), 2)

  // Yesterday's entries don't count.
  const yesterday = new Date("2026-11-25T15:00:00")
  assert.equal(await countUsageToday({ usageFile, now: yesterday }), 0)
})

test("countUsageToday skips malformed lines", async (t) => {
  const usageFile = await tempUsageFile(t)
  const { writeFile } = await import("node:fs/promises")
  await writeFile(
    usageFile,
    [
      JSON.stringify({ timestamp: new Date().toISOString(), modelId: "a" }),
      "not json at all",
      JSON.stringify({ modelId: "no-timestamp" }),
      JSON.stringify({ timestamp: new Date().toISOString(), modelId: "b" }),
      "",
    ].join("\n") + "\n",
  )

  assert.equal(await countUsageToday({ usageFile }), 2)
})

test("usageFileFromEnvironment lets SAIA_USAGE_FILE redirect the ledger", async () => {
  const { usageFileFromEnvironment, USAGE_FILE } = await import("./saia-usage.mjs")

  assert.equal(usageFileFromEnvironment({}), USAGE_FILE)
  assert.equal(usageFileFromEnvironment({ SAIA_USAGE_FILE: "  " }), USAGE_FILE)
  assert.equal(usageFileFromEnvironment({ SAIA_USAGE_FILE: "/tmp/ledger.jsonl" }), "/tmp/ledger.jsonl")

  // countUsageToday follows the same override.
  assert.equal(await countUsageToday({ usageFile: "/tmp/ledger.jsonl" }), null)
})
