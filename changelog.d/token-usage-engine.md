### Added

- **Provider quota readings for Claude, Codex and Antigravity (agy).** A quota service returns usage windows (percent used, reset time), plan label and credits per provider, read only when asked and never on a background timer. Claude reuses wmux's existing usage API; Codex queries its app-server rate limits and falls back to the limits Codex records in its own session files when no app-server answers; agy is read from a small statusLine sensor (`quota-sink.js`) that chains an existing statusLine instead of replacing it and stores only quota, plan, model and context metrics. Average tokens per message are computed from local Claude and Codex transcripts.
- **Read-only inventory of what each CLI loads.** MCP servers (and their tools), skills, plugins, hooks and built-in tools for Claude, Codex and agy, plus the individual wmux core tools per provider.
- **Safe configuration writers.** Per-CLI writers can switch those items off and on. Every write is atomic, takes a timestamped `*.bak-wmux-<timestamp>` backup first, edits JSON and TOML while preserving comments and ordering, re-parses before committing and rolls back on failure. Editing is enabled only on CLI versions that were tested (agy 1.2.14, Codex 0.159.2); other versions stay read-only.
- **Drift detection and saved surface profiles.** wmux hashes the config files it wrote and reports out-of-band edits; a profile snapshots the on/off state across CLIs so it can be previewed and re-applied.

These are main-process services and IPC handlers; the settings UI that uses them follows in the next PR.
