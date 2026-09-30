### Added

- `--role=<Role>` MCP surface: a role-bound agent sees only the wmux tools its role uses (Planner 6, Reviewer 5,
  Builder/Tester none), and `wmux role resolve --json` prints the per-CLI tokens to launch it that way.
- Settings › Agents › Token usage: switch every bound role to a Balanced or Minimal model/effort in one step, with a
  preview; see what each role launches and how many wmux tools it gets.
- `npm run test:agent`, `test:changed` and `typecheck:quiet` for short test output.

### Changed

- agy (Antigravity CLI) can be chosen again in Roles & fan-out; the row notes that fan-out keeps its default agent
  for that role. **agy honours no ignore file** (`.gitignore`, `.geminiignore`, `.agyignore`, not even with
  `--sandbox`): keep material that must not leave the machine out of its workspace.

### Fixed

- The runtime test lane no longer writes into the live `~/.wmux`.
