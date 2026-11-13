# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.4.x   | Yes       |
| 0.3.x   | No        |
| 0.2.x   | No        |
| 0.1.x   | No        |

## Security Model

The SAIA plugin for OpenCode connects to the GWDG Chat AI API to provide AI model access. This document describes the security model and practices.

### API Key Management

- The `SAIA_API_KEY` environment variable must be set by the user
- Alternatively, an `apiKeyCommand` in `~/.config/opencode/saia.json` can read
  the key from a password manager so it is never written to disk in plain text
- API keys are NEVER logged to console output
  - Error messages mask keys: show only first 4 and last 4 characters
  - Example: `abc...xyz` instead of `abcdef123456xyz789`
- Keys are stored in shell config files (`.bashrc`, `.zshrc`) only with explicit user consent
- No telemetry data is sent to external services
- Usage analytics are stored only locally in `~/.cache/saia/`

### Script Security

- All shell scripts use `set -euo pipefail` for error confinement
- Path traversal protection: scripts reject paths containing `..`
- Input validation: all command-line arguments are validated
- Temporary files use `.tmp` suffix with atomic rename
- No root/sudo execution required

### Data Storage

| Data | Location | Purpose |
|------|----------|---------|
| API key | `SAIA_API_KEY` env var | Authentication |
| Model cache | `~/.cache/saia/models.json` | Reduce API calls (24h TTL) |
| Usage logs | `~/.cache/saia/usage.jsonl` | Local analytics only |
| Metrics | `~/.cache/saia/metrics.json` | Performance tracking |
| Preferences | `~/.config/opencode/saia-preferences.json` | User settings |

### Reporting a Vulnerability

Please report security issues privately, not in a public issue:

- **GitHub (primary):** open a private advisory via
  https://github.com/tobias-weiss-ai-xr/opencode-saia-plugin/security/advisories/new
- **Codeberg (mirror):** use Codeberg's security contact mechanism at
  https://codeberg.org/graphwiz-ai/opencode-saia-plugin

Do not disclose the vulnerability publicly until a fix has been released.
