// Model load ("demand") tracking for the TUI widget.
//
// SAIA's /v1/models describes each deployment with a numeric `demand` field
// (current load) and a `status` field ("ready" | "loading" | "offline") — the
// same payload that powers the demand bars on https://saia.gwdg.de/models.
// The provider setup caches the model list for 24h, which is far too stale
// for live load, so this module keeps its own short-TTL snapshot on disk that
// the TUI widget polls.

import os from "node:os"
import path from "node:path"

export const SAIA_MODELS_ENDPOINT = "https://chat-ai.academiccloud.de/v1/models"
export const DEMAND_CACHE_FILE = path.join(os.homedir(), ".cache", "saia", "demand.json")
export const DEMAND_TTL_MS = 60_000

export type DemandLevel = "low" | "medium" | "high" | "very high"

export interface DemandEntry {
  demand: number | null
  status: string | null
}

export type DemandIndex = Record<string, DemandEntry>

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

// Thresholds mirror the Chat AI web UI (gwdg/chat-ai, DemandIndicator):
// demand <= 1 is low, <= 3 medium, <= 5 high, anything above very high.
export function demandLevel(demand: unknown): DemandLevel | undefined {
  if (demand === null || demand === undefined || demand === "") return undefined
  const value = Number(demand)
  if (!Number.isFinite(value)) return undefined
  if (value <= 1) return "low"
  if (value <= 3) return "medium"
  if (value <= 5) return "high"
  return "very high"
}

// Widget label for one model entry, e.g. "load: high". Empty when unknown.
export function formatDemand(entry: unknown): string {
  if (!isRecord(entry)) return ""
  const status = typeof entry.status === "string" ? entry.status : ""
  if (status && status !== "ready") return `load: ${status}`
  const level = demandLevel(entry.demand)
  return level ? `load: ${level}` : ""
}

// Indexes a /v1/models payload by model id, keeping only the load fields.
export function extractDemandIndex(payload: unknown): DemandIndex {
  const index: DemandIndex = {}
  if (!isRecord(payload) || !Array.isArray(payload.data)) return index

  for (const model of payload.data) {
    if (!isRecord(model) || typeof model.id !== "string" || !model.id.trim()) continue
    const demand = Number(model.demand)
    index[model.id.trim()] = {
      demand: Number.isFinite(demand) ? demand : null,
      status: typeof model.status === "string" && model.status ? model.status : null,
    }
  }
  return index
}

export interface DemandTrackerOptions {
  fetchImpl?: typeof globalThis.fetch
  resolveApiKey?: () => Promise<string | undefined>
  endpoint?: string
  cacheFile?: string
  ttlMs?: number
  onWarning?: (message: string) => void
}

export interface DemandTracker {
  getDemand(modelID: unknown): Promise<DemandEntry | undefined>
  getIndex(): Promise<DemandIndex>
}

// Fetches /v1/models and serves per-model load from an in-memory snapshot with
// a short-TTL disk fallback, so the TUI can poll cheaply and survive outages.
export function createDemandTracker({
  fetchImpl = globalThis.fetch,
  resolveApiKey,
  endpoint = SAIA_MODELS_ENDPOINT,
  cacheFile = DEMAND_CACHE_FILE,
  ttlMs = DEMAND_TTL_MS,
  onWarning = console.warn,
}: DemandTrackerOptions = {}): DemandTracker {
  let memory: { index: DemandIndex; timestamp: number } | undefined
  let inflight: Promise<DemandIndex> | undefined

  async function fetchIndex(): Promise<DemandIndex> {
    const apiKey = resolveApiKey ? await resolveApiKey() : process.env.SAIA_API_KEY
    if (!apiKey) throw new Error("no SAIA API key available")

    const response = await fetchImpl(endpoint, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5_000),
    })
    if (!response.ok) {
      throw new Error(`SAIA API returned ${response.status}: ${response.statusText}`)
    }
    return extractDemandIndex(await response.json())
  }

  async function readCache({ allowStale = false } = {}): Promise<DemandIndex | undefined> {
    try {
      const fs = await import("node:fs/promises")
      const cached = JSON.parse(await fs.readFile(cacheFile, "utf8"))
      const fresh = Date.now() - cached.timestamp < ttlMs
      if ((fresh || allowStale) && isRecord(cached.index)) {
        if (fresh) memory = { index: cached.index as DemandIndex, timestamp: cached.timestamp }
        return cached.index as DemandIndex
      }
    } catch {
      // No cache yet or unreadable.
    }
  }

  async function writeCache(index: DemandIndex): Promise<void> {
    try {
      const fs = await import("node:fs/promises")
      await fs.mkdir(path.dirname(cacheFile), { recursive: true })
      const tmp = `${cacheFile}.tmp`
      await fs.writeFile(tmp, JSON.stringify({ index, timestamp: Date.now() }, null, 2))
      await fs.rename(tmp, cacheFile)
    } catch (error) {
      onWarning(`[SAIA] Failed to cache model load: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async function loadIndex(): Promise<DemandIndex> {
    if (memory && Date.now() - memory.timestamp < ttlMs) return memory.index

    const cached = await readCache()
    if (cached) return cached

    if (!inflight) {
      const pending = (async () => {
        const index = await fetchIndex()
        memory = { index, timestamp: Date.now() }
        await writeCache(index)
        return index
      })()
      inflight = pending
      void pending
        .catch(() => {})
        .then(() => {
          if (inflight === pending) inflight = undefined
        })
    }
    return inflight
  }

  return {
    // Per-model load entry ({ demand, status }) or undefined when unknown.
    async getDemand(modelID) {
      if (typeof modelID !== "string" || !modelID) return undefined
      try {
        return (await loadIndex())[modelID]
      } catch (error) {
        // Serve the last snapshot even when it is stale rather than nothing.
        const stale = await readCache({ allowStale: true })
        if (stale) return stale[modelID]
        onWarning(`[SAIA] Failed to fetch model load: ${error instanceof Error ? error.message : String(error)}`)
        return undefined
      }
    },

    async getIndex() {
      try {
        return await loadIndex()
      } catch {
        return (await readCache({ allowStale: true })) ?? {}
      }
    },
  }
}
