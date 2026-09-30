### Added

- **Roles & fan-out: models to pick, effort and permission options.** Each
  role row's model field now opens the models its agent CLI reports (`agy
  models`, `codex debug models`, Claude's list), filters as you type, still
  takes any id by hand, and has a Refresh models button. Under the row: an
  effort selector (Claude `--effort`, Codex `-c model_reasoning_effort=…`,
  and for agy the effort variant of the chosen model, since agy encodes it in
  the model id), a Skip permissions checkbox that uses each CLI's own flag
  (`--dangerously-skip-permissions`, `--dangerously-bypass-approvals-and-sandbox`),
  and a mono preview of the launch the binding produces. Flags already typed
  on a launch still win.

### Fixed

- **The role model field showed only the current value when reopened.** The
  native datalist filtered by what was already in the field; the new combobox
  shows the full list on open and filters only while typing.
