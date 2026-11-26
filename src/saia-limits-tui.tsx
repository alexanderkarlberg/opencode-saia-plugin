/** @jsxImportSource @opentui/solid */

import { createSignal, onCleanup, onMount } from "solid-js"
import type { ColorInput } from "@opentui/core"
import type { Plugin } from "@opencode/plugin/tui"
import type { TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { type DemandEntry, createDemandTracker, demandLevel } from "./saia/saia-demand.js"
import { resolveSaiaApiKey } from "./saia/saia-api-key.mjs"

// The TUI polls the SAIA model list for live load more often than the 60s
// demand cache TTL would imply, so the widget tracks the selected model's
// `demand` field alongside the quota counters.
const DEMAND_POLL_MS = 30_000

// Signal-strength bars mirroring the Chat AI web UI (gwdg/chat-ai,
// DemandIndicator): low load shows all four bars in green, rising load
// drops bars and shifts color towards red.
const DEMAND_STYLE = {
  low: { color: "green", bars: "▮▮▮▮" },
  medium: { color: "yellow", bars: "▮▮▮▯" },
  high: { color: "orange", bars: "▮▮▯▯" },
  "very high": { color: "red", bars: "▮▯▯▯" },
} as const

let demandTracker
function getDemandTracker() {
  if (!demandTracker) {
    demandTracker = createDemandTracker({ resolveApiKey: resolveSaiaApiKey })
  }
  return demandTracker
}

function formatRemaining(value: unknown) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 1000) return String(value)

  const thousands = number / 1000
  return `${thousands.toFixed(1).replace(/\.0$/, "")}k`
}

export function displayLimits(value: unknown) {
  return quotaSegments(value)
    .map((segment) => segment.text)
    .join(" · ")
}

export interface QuotaSegment {
  text: string
  color?: string
}

// Green while more than half the window is left, yellow past 30 %,
// orange past 10 %, red at or below that.
export function quotaColor(remaining: number, limit: number): string {
  const ratio = limit > 0 ? remaining / limit : 1
  if (ratio > 0.5) return "green"
  if (ratio > 0.3) return "yellow"
  if (ratio > 0.1) return "orange"
  return "red"
}

// Quota counters as separately colorable footer segments, e.g.
// [{ text: "9/10 10s", color: "green" }]. Segments without a known limit
// carry no color and render muted.
export function quotaSegments(value: unknown): QuotaSegment[] {
  if (!value || typeof value !== "object") return []

  const limits = value as Record<string, unknown>
  const fields = [
    ["10s", limits.tenSeconds, limits.tenSecondsLimit],
    ["h", limits.hour, limits.hourLimit],
    ["d", limits.day, limits.dayLimit],
  ].filter(([, remaining]) => remaining !== null && remaining !== undefined && String(remaining) !== "")

  return fields.map(([unit, remaining, limit]) => {
    const hasLimit = limit !== null && limit !== undefined && String(limit) !== ""
    const remainingNumber = Number(remaining)
    const limitNumber = Number(limit)

    return {
      text: hasLimit
        ? `${formatRemaining(remaining)}/${formatRemaining(limit)} ${unit}`
        : `${formatRemaining(remaining)}/${unit}`,
      color:
        hasLimit && Number.isFinite(remainingNumber) && Number.isFinite(limitNumber)
          ? quotaColor(remainingNumber, limitNumber)
          : undefined,
    }
  })
}

export interface DemandSegment {
  text: string
  color: string
}

// The colored footer segment for one model's load entry, e.g.
// { text: "▮▮▮▯ load: medium", color: "yellow" }. undefined when unknown.
export function demandSegment(entry: DemandEntry | undefined): DemandSegment | undefined {
  if (!entry) return undefined

  if (entry.status && entry.status !== "ready") {
    const offline = entry.status === "offline"
    return { text: `load: ${entry.status}`, color: offline ? "red" : "cyan" }
  }

  const level = demandLevel(entry.demand)
  if (!level) return undefined
  const style = DEMAND_STYLE[level]
  return { text: `${style.bars} load: ${level}`, color: style.color }
}

// Combines the quota counters with the selected model's load label (plain
// text variant of the footer; the widget colors the load part separately).
export function displaySessionStatus(metadata: unknown, load: string) {
  const limits = displayLimits((metadata as Record<string, unknown> | undefined)?.saiaLimits)
  return [load, limits].filter(Boolean).join(" · ")
}

// Polls the demand index for the session's current SAIA model (recorded as
// `saiaModel` in the session metadata by the limits server hooks).
function useModelLoad(getMetadata: () => Record<string, unknown> | undefined) {
  const [entry, setEntry] = createSignal<DemandEntry | undefined>(undefined)

  const refresh = async () => {
    const modelID = getMetadata()?.saiaModel
    setEntry(typeof modelID === "string" ? await getDemandTracker().getDemand(modelID) : undefined)
  }

  onMount(() => {
    void refresh()
    const interval = setInterval(() => void refresh(), DEMAND_POLL_MS)
    onCleanup(() => clearInterval(interval))
  })

  return entry
}

// One muted footer line: the colored load segment first, then the quota
// counters, each colored by how much of its window is left. Kept in a
// single row so all parts truncate together.
function SaiaFooter(props: {
  muted: ColorInput
  load: () => DemandSegment | undefined
  quotas: () => QuotaSegment[]
}) {
  return (
    <box height={1} minWidth={0} flexShrink={1} overflow="hidden" flexDirection="row">
      {props.load() ? (
        <text height={1} wrapMode="none" truncate fg={props.load()!.color}>
          {props.load()!.text}
        </text>
      ) : undefined}
      {props.quotas().map((quota, index) => (
        <text
          height={1}
          wrapMode="none"
          truncate
          fg={quota.color ?? props.muted}
        >
          {(props.load() || index > 0 ? " · " : "") + quota.text}
        </text>
      ))}
    </box>
  )
}

function SaiaLimits(props: { ctx: Plugin.Context; sessionID?: string }) {
  const metadata = () =>
    props.sessionID ? props.ctx.data.session.get(props.sessionID)?.metadata : undefined
  const entry = useModelLoad(metadata)

  return (
    <SaiaFooter
      muted={props.ctx.theme.text.muted}
      load={() => demandSegment(entry())}
      quotas={() => quotaSegments(metadata()?.saiaLimits)}
    />
  )
}

function V1SaiaLimits(props: { api: TuiPluginApi; session_id?: string }) {
  const metadata = () => props.api.state.session.get(props.session_id)?.metadata
  const entry = useModelLoad(metadata)

  return (
    <SaiaFooter
      muted={props.api.theme.current.textMuted}
      load={() => demandSegment(entry())}
      quotas={() => quotaSegments(metadata()?.saiaLimits)}
    />
  )
}

// OpenCode 2.x registration: claim "prompt.footer" through the TUI context.
const v2Setup = (ctx: Plugin.Context) => {
  // Guard against being loaded by a non-TUI host (e.g. OpenCode's server-side
  // plugin discovery): there is no slot tree to render into.
  if (typeof ctx?.ui?.slot !== "function") return

  ctx.ui.slot({
    append: "prompt.footer",
    render: (input) => <SaiaLimits ctx={ctx} sessionID={input.sessionID} />,
  })
}

// OpenCode 1.x registration: the "tui" key is ignored by OpenCode 2.x and vice versa.
const v1Tui = async (api: TuiPluginApi) => {
  api.slots.register({
    order: 100,
    slots: {
      session_prompt_right(_context, props) {
        return <V1SaiaLimits api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin = {
  id: "saia-limits-tui",
  setup: v2Setup,
  tui: v1Tui,
} as TuiPluginModule & { setup: (ctx: Plugin.Context) => void }

export default plugin

// See saia-plugin.ts: installed plugin files can be evaluated as CommonJS outside this
// repository's package boundary. Keep the TUI module's default and named helper usable.
if (typeof module !== "undefined") {
  module.exports = plugin
  module.exports.displayLimits = displayLimits
  module.exports.displaySessionStatus = displaySessionStatus
  module.exports.demandSegment = demandSegment
  module.exports.quotaColor = quotaColor
  module.exports.quotaSegments = quotaSegments
}
