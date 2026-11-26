import assert from "node:assert/strict"
import test from "node:test"
import plugin from "./saia-plugin.ts"
import tuiPlugin, {
  demandSegment,
  displayLimits,
  displaySessionStatus,
  quotaColor,
  quotaSegments,
} from "./saia-limits-tui.tsx"

test("server plugin exports the dual V1+V2 definition", async () => {
  assert.equal(plugin.id, "saia")
  assert.equal(typeof plugin.setup, "function")
  assert.equal(typeof plugin.server, "function")

  // V1 path: opencode < 2 calls server({ client }) and gets the V1 hook set.
  const hooks = await plugin.server({
    client: {
      app: {
        async log() {},
      },
    },
  })

  assert.equal(typeof hooks.config, "function")
  assert.equal(typeof hooks["chat.headers"], "function")
  assert.equal(typeof hooks["experimental.chat.system.transform"], "function")
})

test("formats quota labels and registers the TUI prompt footer slot", async () => {
  const limits = { tenSeconds: "26", tenSecondsLimit: "10", hour: "128", hourLimit: "400", day: "530", dayLimit: "800" }

  // SAIA exposes 10s/hour/day windows only; minute/month are not reported.
  assert.equal(
    displayLimits({ tenSeconds: "9", hour: "199", day: null }),
    "9/10s · 199/h",
  )
  assert.equal(displayLimits(limits), "26/10 10s · 128/400 h · 530/800 d")
  assert.equal(displayLimits({}), "")

  // The footer combines the model load label with the quota counters.
  assert.equal(displaySessionStatus({ saiaLimits: { hour: "128", day: "530" } }, "load: high"), "load: high · 128/h · 530/d")
  assert.equal(displaySessionStatus({ saiaLimits: { hour: "128" } }, ""), "128/h")
  assert.equal(displaySessionStatus(undefined, "load: low"), "load: low")
  assert.equal(displaySessionStatus(undefined, ""), "")

  let claim
  const ctx = {
    ui: {
      slot(input) {
        claim = input
      },
    },
    data: {
      session: {
        get() {
          return { metadata: { saiaLimits: limits } }
        },
      },
    },
    theme: { text: { muted: "#808080" } },
  }

  // v2 TUI shape: { id, setup(ctx) } claiming "prompt.footer".
  assert.equal(tuiPlugin.id, "saia-limits-tui")
  assert.equal(typeof tuiPlugin.setup, "function")

  tuiPlugin.setup(ctx)
  assert.equal(claim.append, "prompt.footer")
  assert.equal(typeof claim.render, "function")

  // Never throws when loaded by a non-TUI host (no slot tree at all).
  tuiPlugin.setup({})
  tuiPlugin.setup(undefined)

  // V1 registration still works: tui.tui(api) registers session_prompt_right.
  let registered
  await tuiPlugin.tui({
    state: {
      session: {
        get() {
          return { metadata: { saiaLimits: limits } }
        },
      },
    },
    theme: { current: { textMuted: "#808080" } },
    slots: {
      register(value) {
        registered = value
      },
    },
  })

  assert.equal(registered.order, 100)
  assert.equal(typeof registered.slots.session_prompt_right, "function")
})

test("demand segment renders colored bars and labels", () => {
  assert.deepEqual(demandSegment({ demand: 0, status: "ready" }), { text: "▮▮▮▮ load: low", color: "green" })
  assert.deepEqual(demandSegment({ demand: 2, status: "ready" }), { text: "▮▮▮▯ load: medium", color: "yellow" })
  assert.deepEqual(demandSegment({ demand: 4, status: "ready" }), { text: "▮▮▯▯ load: high", color: "orange" })
  assert.deepEqual(demandSegment({ demand: 9, status: "ready" }), { text: "▮▯▯▯ load: very high", color: "red" })
  assert.deepEqual(demandSegment({ demand: null, status: "loading" }), { text: "load: loading", color: "cyan" })
  assert.deepEqual(demandSegment({ demand: null, status: "offline" }), { text: "load: offline", color: "red" })
  assert.equal(demandSegment(undefined), undefined)
  assert.equal(demandSegment({ demand: null, status: "ready" }), undefined)
})

test("quota segments are colored by the remaining ratio", () => {
  assert.deepEqual(
    quotaSegments({ tenSeconds: "5", tenSecondsLimit: "10", hour: "1", hourLimit: "10", day: "9", dayLimit: "10" }),
    [
      { text: "5/10 10s", color: "yellow" },
      { text: "1/10 h", color: "red" },
      { text: "9/10 d", color: "green" },
    ],
  )

  // Segments without a known limit stay muted.
  const unknown = quotaSegments({ hour: "199" })
  assert.equal(unknown.length, 1)
  assert.equal(unknown[0].text, "199/h")
  assert.equal(unknown[0].color, undefined)

  assert.deepEqual(quotaSegments({}), [])
  assert.deepEqual(quotaSegments(undefined), [])
})

test("quota color thresholds sit at 50 / 30 / 10 percent remaining", () => {
  assert.equal(quotaColor(6, 10), "green", "60 % is green")
  assert.equal(quotaColor(5, 10), "yellow", "50 % exactly drops out of green")
  assert.equal(quotaColor(4, 10), "yellow", "40 % is yellow")
  assert.equal(quotaColor(31, 100), "yellow", "31 % is yellow")
  assert.equal(quotaColor(30, 100), "orange", "30 % exactly drops out of yellow")
  assert.equal(quotaColor(11, 100), "orange", "11 % is orange")
  assert.equal(quotaColor(10, 100), "red", "10 % exactly drops out of orange")
  assert.equal(quotaColor(1, 10), "red")
  assert.equal(quotaColor(0, 10), "red")
  assert.equal(quotaColor(5, 0), "green", "no usable limit is never an alarm")
})
