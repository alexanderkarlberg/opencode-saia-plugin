// Request ledger for SAIA API calls.
//
// Every request the limits hooks see through the SAIA provider is appended
// as one JSONL entry to ~/.cache/saia/usage.jsonl — including non-2xx
// responses, which still count against SAIA's request quota. analytics-
// report.sh reads the same file for its per-model statistics.

import os from "node:os"
import path from "node:path"

export const USAGE_FILE = path.join(os.homedir(), ".cache", "saia", "usage.jsonl")

// The ledger location can be redirected (tests use this to isolate the
// real file); SAIA_USAGE_FILE wins over the default path.
export function usageFileFromEnvironment(environment = process.env) {
  const override = environment.SAIA_USAGE_FILE?.trim()
  return override ? override : USAGE_FILE
}

// Appends one ledger entry. Never throws: a failed bookkeeping write must
// not affect the provider response it travels with.
export async function logSaiaRequest(
  { modelId, sessionID, status, latencyMs },
  { usageFile } = {},
) {
  const target = usageFile ?? usageFileFromEnvironment()
  try {
    const fs = await import("node:fs/promises")
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.appendFile(
      target,
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        projectRoot: process.cwd(),
        modelId: modelId ?? null,
        sessionID: sessionID ?? null,
        status: status ?? null,
        latencyMs: latencyMs ?? null,
      })}\n`,
    )
  } catch (error) {
    console.error(`[SAIA] Failed to log request usage: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// Counts ledger entries recorded today (local time). Returns null when no
// ledger exists yet, so callers can hide the counter instead of showing 0.
export async function countUsageToday({ usageFile, now = new Date() } = {}) {
  const target = usageFile ?? usageFileFromEnvironment()
  let raw
  try {
    const fs = await import("node:fs/promises")
    raw = await fs.readFile(target, "utf8")
  } catch {
    return null
  }

  const today = now.toDateString()
  let count = 0
  for (const line of raw.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const entry = JSON.parse(trimmed)
      if (typeof entry.timestamp === "string" && new Date(entry.timestamp).toDateString() === today) {
        count += 1
      }
    } catch {
      // Skip malformed lines rather than failing the count.
    }
  }
  return count
}
