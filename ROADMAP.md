# Roadmap: SAIA OpenCode Plugin

This roadmap tracks what has shipped and what is still open. The plugin was
originally a thin shell/`opencode.json` generator; it is now a native OpenCode
plugin that registers the `saia` provider at runtime. Much of the
original roadmap is therefore already implemented.

---

## Shipped

| Capability | Where |
|---|---|
| Native OpenCode plugin (V1) | `src/saia.ts`, `src/saia-plugin.ts` |
| Live model discovery with 24 h disk cache | `src/saia.ts`, `src/saia-memory.ts` |
| Provider registration / config decoration | `src/saia.ts`, `src/saia-model-metadata.js` |
| L0/L1 caching, usage tracking, metrics | `src/saia-memory.ts` |
| Live rate-limit quota widget (TUI) | `src/saia-limits-server.js`, `src/saia-limits-tui.tsx` |
| Model load ("demand") widget (TUI) | `src/saia-demand.ts`, `src/saia-limits-tui.tsx` |
| Transport selection (chat-completions / responses) | `src/saia-transport.mjs`, `src/set-saia-transport.mjs` |
| API-key resolution (`SAIA_API_KEY`, `apiKeyCommand`, settings) | `src/saia-api-key.mjs` |
| Model group aliases (`best-for-coding`, `fastest`, …) | `src/generate-saia-config.sh`, README |
| Config profiles (production / development / budget) | `src/generate-saia-config.sh` |
| JSON-schema config validation | `src/validate-config.sh`, `schema/opencode.schema.json` |
| Interactive setup wizard | `src/setup-wizard.sh` |
| Plugin self-update / release prep | `src/update-plugin.sh`, `prepare-release.sh` |
| Model metadata derived from the live API | `src/saia-model-metadata.js`, `src/reconcile-opencode-models.sh` |
| Health / analytics / A-B / config-sync scripts | `src/health-report.sh`, `src/analytics-report.sh`, `src/ab-test.sh`, `src/sync-config.sh`, `src/merge-config.sh` |
| One-command cross-platform installers | `install.sh`, `install.ps1` |

---

## Open — Short Term

### 1. Fallback model configuration
- **Impact**: High · **Effort**: Medium
- Auto-switch to a backup model on errors; per-provider fallbacks and a
  `primary_retry_attempts` option.
- **Files**: `src/opencode-saia.json`, `src/saia.ts`, `README.md`

### 2. Per-model cost / latency hints
- **Impact**: Medium · **Effort**: Low
- Surface `cost_per_1k_tokens`, `estimated_latency_ms` and `recommended_for`
  tags in the generated catalog to guide model choice.
- **Files**: `src/saia-model-metadata.js`, `src/generate-saia-config.sh`

---

## Open — Medium Term

### 3. Multi-provider support
- **Impact**: High · **Effort**: Medium-High
- Optional LiteLLM-native provider, local providers (Ollama/llama.cpp) and
  cross-provider fallback within a service class.
- **Files**: `src/provider/*.sh`, `src/saia.ts`, `README.md`

### 4. Model health dashboard
- **Impact**: Medium · **Effort**: Medium
- Extend `health-report.sh` into a structured JSON health view (latency, error
  rates, degraded/unavailable flags) consumable by the TUI.
- **Files**: `src/health-report.sh`, `src/saia-limits-tui.tsx`

---

## Open — Long Term

### 5. Packaging and distribution
- **Impact**: Medium · **Effort**: Medium
- Optional npm package, Homebrew formula, and signed release artifacts with
  checksums and release automation.
- **Files**: `package.json`, `Dockerfile`, `.github/workflows/`, `install.sh`

### 6. Documentation
- **Impact**: Low · **Effort**: Low
- Troubleshooting flowchart, model comparison table (cost/speed/quality),
  German translation for SAIA users.
- **Files**: `README.md`, `FAQ.md`

### 7. Security review
- **Impact**: High · **Effort**: Medium
- Formal threat model: audit API-key handling, validate script paths, review
  `jq`/`sed` regexes for ReDoS, add checksum validation for downloads.
- **Files**: `SECURITY.md`, `src/*.sh`, `src/saia.ts`

---

## Guiding Principles

- **Dependencies**: keep external deps minimal (`curl`, `jq`, `node`/`bun`).
- **Backward compatibility**: new features must not break existing setups.
- **OpenCode integration**: stay compatible with the official plugin API.
- **Community**: engage with the SAIA and OpenCode communities for model
  updates and best practices.

This roadmap is a living document. Items can be added, removed, or reprioritized
based on user feedback, OpenCode API changes, and SAIA service updates.
