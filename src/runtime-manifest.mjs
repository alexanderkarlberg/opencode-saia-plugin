// Files owned by the installed SAIA runtime. Keep this list explicit so all
// installation paths ship the same loadable module set and never copy tests.
export const SAIA_RUNTIME_FILES = Object.freeze([
  "install-runtime.mjs",
  "install-tui-config.mjs",
  "runtime-manifest.mjs",
  "saia-api-key.mjs",
  "saia-config.mjs",
  "saia-limits-server.js",
  "saia-memory.ts",
  "saia-model-metadata.js",
  "saia-settings.mjs",
  "saia-system-messages.js",
  "saia-transport.mjs",
  "saia-v2.mjs",
  "saia.ts",
  "set-saia-transport.mjs",
  "update-plugin.sh",
  "provider/ollama.sh",
])

// OpenCode 2.x discovers plugins as package directories and reads the server
// entry from index.ts and the TUI entry from tui.tsx. The sources below are
// copied into plugins/saia/ under those names.
export const SAIA_ENTRY_FILES = Object.freeze([
  { source: "saia-plugin.ts", destination: "index.ts" },
  { source: "saia-limits-tui.tsx", destination: "tui.tsx" },
])

// Loose entrypoints from the pre-0.5.0 layout. They must not survive an
// upgrade: OpenCode 2.x would discover both them and the package entries and
// load the server plugin twice.
export const SAIA_LEGACY_ENTRY_FILES = Object.freeze([
  "saia-plugin.ts",
  "saia-limits-tui.tsx",
])
