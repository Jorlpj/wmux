### Added

- **Orchestrator effort picker.** Settings → Orchestrator has an effort row
  (low / medium / high / xhigh / max, or the CLI default). It reaches both
  Claude brains — the SDK brain as `options.effort`, the terminal brain as
  `--effort` — and, like the model, applies from the next turn: an idle brain
  is swapped, a busy one finishes its turn first.

### Changed

- **Opus 5.5 and Sonnet 5.5 in every Claude model picker.** The deck chip, the
  Settings orchestrator picker and the role-binding suggestions now share one
  list with the full ids (`claude-opus-5-5`, `claude-sonnet-5-5`,
  `claude-haiku-4-5-20251001`) next to the `opus` / `sonnet` / `haiku` aliases,
  which follow whatever the installed claude maps them to. A model id not in
  the list shows as itself instead of as "Default".
