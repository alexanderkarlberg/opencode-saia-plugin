import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { removeTuiPluginRegistration, TUI_PLUGIN_PATH } from "./install-tui-config.mjs"

test("removes the legacy registration from tui.json and keeps other plugins", async () => {
  const directory = await mkdtemp(path.join(process.cwd(), ".opencode-saia-plugin-test-"))
  const configPath = path.join(directory, "tui.json")

  try {
    await writeFile(
      configPath,
      JSON.stringify({
        $schema: "https://opencode.ai/tui.json",
        theme: "my-theme",
        plugin: ["./plugins/existing.tsx", TUI_PLUGIN_PATH],
      }),
    )

    const result = await removeTuiPluginRegistration(directory)
    const config = JSON.parse(await readFile(configPath, "utf8"))

    assert.equal(result.changed, true)
    assert.deepEqual(config.plugin, ["./plugins/existing.tsx"])
    assert.equal(config.theme, "my-theme")

    const second = await removeTuiPluginRegistration(directory)
    assert.equal(second.changed, false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("drops the key entirely when no other plugins remain", async () => {
  const directory = await mkdtemp(path.join(process.cwd(), ".opencode-saia-plugin-test-"))
  const tuiPath = path.join(directory, "tui.json")
  const cliPath = path.join(directory, "cli.json")

  try {
    await writeFile(tuiPath, JSON.stringify({ plugin: [TUI_PLUGIN_PATH] }))
    await writeFile(cliPath, JSON.stringify({ animations: true, plugins: [TUI_PLUGIN_PATH] }))

    const result = await removeTuiPluginRegistration(directory)

    assert.equal(result.changed, true)
    assert.equal(JSON.parse(await readFile(tuiPath, "utf8")).plugin, undefined)
    const cli = JSON.parse(await readFile(cliPath, "utf8"))
    assert.equal(cli.plugins, undefined)
    assert.equal(cli.animations, true)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("ignores missing or malformed configuration files", async () => {
  const directory = await mkdtemp(path.join(process.cwd(), ".opencode-saia-plugin-test-"))
  const cliPath = path.join(directory, "cli.json")

  try {
    const missing = await removeTuiPluginRegistration(directory)
    assert.equal(missing.changed, false)

    await writeFile(cliPath, JSON.stringify({ plugins: "not-an-array" }))
    const malformed = await removeTuiPluginRegistration(directory)
    assert.equal(malformed.changed, false)
    assert.equal(malformed.cliConfigPath, cliPath)
    assert.equal(JSON.parse(await readFile(cliPath, "utf8")).plugins, "not-an-array")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
