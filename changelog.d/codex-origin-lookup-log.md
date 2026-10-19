### Fixed

- **The Codex log says when the origin check ran out of time.** Before a Codex
  notification is sent, the bridge looks up which program started it, so a
  turn from a shared Codex app-server is not sent to the pane it inherited.
  On Windows that lookup starts PowerShell, and on a busy or freshly started
  machine it can run past its 900 ms budget. The notification is then sent to
  the pane anyway, and `codex-notify.log` / `codex-hooks.log` looked the same as
  for a parent that is not Codex. Their lines now carry `originLookupMs`, and
  `originLookupTimedOut: true` when the lookup ran out. Nothing else changes.
