import { copyFile, chmod, mkdir, realpath, rename, rm, unlink, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { removeTuiPluginRegistration } from "./install-tui-config.mjs"
import {
  SAIA_ENTRY_FILES,
  SAIA_LEGACY_ENTRY_FILES,
  SAIA_RUNTIME_FILES,
} from "./runtime-manifest.mjs"

function defaultConfigDir() {
  return path.join(homedir(), ".config", "opencode")
}

async function copyRuntimeFile(sourceDir, targetDir, relativePath) {
  const source = path.join(sourceDir, relativePath)
  const destination = path.join(targetDir, relativePath)

  await mkdir(path.dirname(destination), { recursive: true })
  await copyFile(source, destination)
  if (relativePath.endsWith(".sh")) await chmod(destination, 0o755)
}

export async function installRuntime(sourceDir, configDir = defaultConfigDir()) {
  const pluginRoot = path.join(configDir, "plugins")
  const targetDir = path.join(pluginRoot, "saia")
  const stagingDir = `${targetDir}.${process.pid}.tmp`

  await rm(stagingDir, { recursive: true, force: true })
  await mkdir(stagingDir, { recursive: true })

  try {
    for (const file of SAIA_RUNTIME_FILES) {
      await copyRuntimeFile(sourceDir, stagingDir, file)
    }

    // Entrypoints are staged under their discovered names (index.ts / tui.tsx).
    for (const { source, destination } of SAIA_ENTRY_FILES) {
      await copyRuntimeFile(sourceDir, stagingDir, source)
      await rename(path.join(stagingDir, source), path.join(stagingDir, destination))
    }

    // Mark the installed plugin as an ESM package: without it, hosts loading
    // the entrypoints through node/tsx treat them as CommonJS, where the
    // entrypoints' module.exports guards hide their named exports.
    await writeFile(path.join(stagingDir, "package.json"), `${JSON.stringify({ type: "module" })}\n`)

    await mkdir(pluginRoot, { recursive: true })
    await rm(targetDir, { recursive: true, force: true })
    await rename(stagingDir, targetDir)

    // Remove the loose pre-0.5.0 entrypoints so OpenCode 2.x does not load the
    // plugin twice, and drop their tui.json/cli.json registration.
    for (const file of SAIA_LEGACY_ENTRY_FILES) {
      await unlink(path.join(pluginRoot, file)).catch(() => {})
    }
    const tui = await removeTuiPluginRegistration(configDir)
    return { configDir, pluginRoot, targetDir, tui }
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true })
    throw error
  }
}

async function isMainModule() {
  if (!process.argv[1]) return false
  return import.meta.url === pathToFileURL(await realpath(process.argv[1])).href
}

if (await isMainModule()) {
  const [sourceDir, configDir] = process.argv.slice(2)

  if (!sourceDir) {
    console.error("Usage: node install-runtime.mjs <source-dir> [opencode-config-dir]")
    process.exitCode = 1
  } else {
    try {
      const result = await installRuntime(sourceDir, configDir)
      console.log(`Installed SAIA runtime to ${result.targetDir}`)
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    }
  }
}
