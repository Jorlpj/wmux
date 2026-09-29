### Added

- **wmux recognises the Antigravity CLI (`agy`).** Google replaced the Gemini
  CLI with `agy`, and a pane running it used to look like a bare shell: no
  agent badge, no running/waiting state and no approval alert. The detector now
  opens on the `Antigravity CLI` banner, reads the footer (`esc to cancel` while
  a turn runs, `? for shortcuts` when idle) and raises the project trust screen
  as awaiting input. Patterns come from a live capture of agy 1.2.13.
- **Opt-in MCP registration for the Antigravity CLI.** `wmux mcp register
  --target agy` adds the wmux server to `~/.gemini/config/mcp_config.json`,
  where agy reads its MCP servers. It is never written at boot or by a
  target-less `wmux mcp register`, because agy often runs as a worker whose
  tool surface the operator keeps restricted on purpose.
- **Role bindings can target agy.** `agy` joins the known agent launchers and
  the role-binding agent list, with its `--model` grammar verified (a full
  `agy models` id such as `gemini-3.8-flash-low`). Fan-out lists agy but keeps
  it unselectable: a fresh worktree stops on agy's project trust screen, which
  no flag or environment variable can pre-answer, and its first prompt needs
  `-i` rather than a positional argument.
