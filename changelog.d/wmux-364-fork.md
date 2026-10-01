### Added

- `--role=<Role>` MCP surface: a role-bound agent sees only the wmux tools its role uses (Planner 6, Reviewer 5,
  Builder/Tester none), and `wmux role resolve --json` prints the per-CLI tokens to launch it that way.
- Settings › Agents › Token usage: Full, Coding, Balanced and Minimal profiles set model, effort and a wmux tool level
  (all, core, or only the role's tools) on every bound role in one step, with a preview. Role-bound panes that wmux
  launches get the tool level too.
- Fan-out can run tasks on the agy (Antigravity) CLI: wmux passes the prompt with `-i` and pre-trusts the task's
  worktree in agy's own settings.
- `npm run test:agent`, `test:changed` and `typecheck:quiet` for short test output.

### Changed

- agy (Antigravity CLI) can be chosen in Roles & fan-out. **agy honours no ignore file** (`.gitignore`,
  `.geminiignore`, `.agyignore`, not even with `--sandbox`): keep material that must not leave the machine out of its
  workspace.

### Fixed

- The runtime test lane no longer writes into the live `~/.wmux`.
