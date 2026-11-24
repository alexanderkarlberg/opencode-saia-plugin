// Installed as ~/.config/opencode/plugins/saia/index.ts, the server entrypoint
// of the discovered saia plugin package.
//
// The implementation sits alongside this file so its helper modules are not
// themselves picked up as plugins. The default export is the dual V1+V2
// definition documented in saia.ts: OpenCode 2.x reads id + setup,
// OpenCode >=1.18.29 calls server().
import plugin from "./saia.js"

export default plugin

// The installed plugin package carries "type": "module", so ESM loading is the
// norm. This guard only covers hosts that evaluate the file as CommonJS while
// ignoring package.json: expose the function directly, as OpenCode plugin
// entrypoints expect.
if (typeof module !== "undefined") {
  module.exports = plugin
}
