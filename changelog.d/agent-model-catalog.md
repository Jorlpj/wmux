### Added

- **Model discovery for agent CLIs.** Main can now ask an agent CLI which
  models it runs — `agy models` for the Antigravity CLI, `codex debug models`
  for Codex (with each model's supported reasoning levels), and a built-in list
  for Claude — through `electronAPI.agentModels.list(agent, refresh)`. Results
  are cached for 24 hours in `model-catalog.json` in the wmux data folder;
  discovery runs only when asked, never at startup, and a missing CLI or
  unreadable output yields an empty `unavailable` result instead of an error.
