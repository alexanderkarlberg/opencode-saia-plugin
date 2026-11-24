import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

// Registration path used by plugin versions up to 0.4.x. OpenCode 2.x discovers
// the TUI entry (plugins/saia/tui.tsx) from the plugin package itself, so the
// installer now removes these entries instead of writing them.
export const TUI_PLUGIN_PATH = "./plugins/saia-limits-tui.tsx"

// OpenCode 1.x reads the TUI plugin list from tui.json ("plugin" array).
// OpenCode 2.x reads cli.json ("plugins" array). Both are cleaned so an
// upgrade from the loose-file layout leaves no stale registration behind.
const TUI_CONFIGS = Object.freeze([
  { file: "tui.json", key: "plugin" },
  { file: "cli.json", key: "plugins" },
])

async function upsertRemovedEntry(configDir, { file, key }) {
  const configPath = path.join(configDir, file)
  let config
  try {
    config = JSON.parse(await readFile(configPath, "utf8"))
  } catch {
    return { changed: false, configPath, missing: true }
  }

  if (!config || typeof config !== "object" || Array.isArray(config)) return { changed: false, configPath }
  if (!Array.isArray(config[key])) return { changed: false, configPath }

  const plugins = config[key].filter((entry) => entry !== TUI_PLUGIN_PATH)
  const changed = plugins.length !== config[key].length
  if (!changed) return { changed: false, configPath }

  if (plugins.length === 0) delete config[key]
  else config[key] = plugins

  const temporaryPath = `${configPath}.${process.pid}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`)
  await rename(temporaryPath, configPath)

  return { changed: true, configPath }
}

export async function removeTuiPluginRegistration(configDir = path.join(homedir(), ".config", "opencode")) {
  await mkdir(configDir, { recursive: true })

  const results = await Promise.all(TUI_CONFIGS.map((entry) => upsertRemovedEntry(configDir, entry)))

  return {
    changed: results.some((result) => result.changed),
    configPath: results[0].configPath,
    cliChanged: results[1].changed,
    cliConfigPath: results[1].configPath,
  }
}

async function isMainModule() {
  if (!process.argv[1]) return false
  return import.meta.url === pathToFileURL(await realpath(process.argv[1])).href
}

if (await isMainModule()) {
  const { changed, configPath, cliChanged, cliConfigPath } = await removeTuiPluginRegistration(process.argv[2])
  console.log(`${changed ? "Cleaned" : "Already clean"} ${configPath}`)
  console.log(`${cliChanged ? "Cleaned" : "Already clean"} ${cliConfigPath}`)
}
