### Added

- **`wmux role resolve <Role> [--json]`.** Prints what a role is bound to in
  Settings → Roles & fan-out — agent, model, effort and exec-ready `argv` /
  `flags` in each CLI's own grammar — so a project's own dispatch scripts can
  follow the same bindings as the panes wmux launches. It reads the app's
  `session.json` directly (works with wmux closed), normalizes it the way the
  app does, and exits 2 when the role is not bound.
