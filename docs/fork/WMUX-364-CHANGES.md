# Fork changes on wmux 3.64.0 (branch `wmux-364`, 2026-09-30)

Everything this fork adds on top of upstream 3.64.0. Nothing upstream was removed; where an upstream decision was
revisited (agy in the role list), the original safeguard is kept and made visible instead.

## ⚠ WARNING — agy (Antigravity CLI) does not ignore protected files

Probed on 2026-09-30 with agy 1.2.14 (Gemini 3.8 Flash), asking it to read a canary file each time:

| Mechanism | Does agy still read the file? |
|---|---|
| listed in `.gitignore` | **yes** |
| listed in `.geminiignore` | **yes** |
| listed in `.agyignore` | **yes** |
| absolute path outside every `--add-dir` workspace | **yes** |
| same, with `--sandbox=true` | **yes** (the sandbox restricts the terminal, not file reads) |
| `--mode plan` | **yes** (plan mode blocks edits, not reads) |

**agy has no ignore mechanism.** Anything in its workspace, and any absolute path it is told about, can be read and
sent to the model provider. In the AIOTPM project that means `third_party/firmware-intake/` and
`third_party/infineon-v2.03/` are exposed whenever agy's workspace is the main checkout. The project's own loop now runs
agy in a git worktree, which never contains gitignored trees (`tools/agy_dispatch.py --worktree`, AIOTPM ADR 0039);
live check: agy listing `third_party/` from the worktree saw only `keyauth` and `README.md`. That is exposure
reduction, not a guarantee: an explicit absolute path is still readable. Inside wmux, `fanout_start` gives each task its own
worktree, and it now launches agy there (see below).

## Carried over from the 3.63 fork (PR #1677, C1–C4)

- One Claude model list (Opus/Sonnet 5.5) and an orchestrator effort picker.
- `ModelCatalog`: agy and codex models discovered from their CLIs, cached.
- Role bindings: discovered model picker, effort, skip-permissions.
- `wmux role resolve <Role> --json` for external launchers.

## Deck state hygiene (WMX-04..07, cherry-picked)

- Vitest is isolated from the live `~/.wmux` (temp HOME + `-vitest` suffix).
- Workspace removal tears down all Deck state; orphan Deck state and atomic-write temps are reconciled at startup.
- `wmux deck state --orphans` / `--prune --yes`.

## Added on 3.64.0

| Card | Change |
|---|---|
| C5 | `npm run test:agent`, `test:changed`, `typecheck:quiet`: short output for coding agents (CONTRIBUTING.md). |
| C7 | A vitest run that bypassed the isolate setup refuses the live data dir. Found and fixed: the `test:runtime` lane never had the setup and wrote shell integration under the live `~/.wmux`. |
| C9 | `--role=<Planner/Reviewer/Builder/Tester>` MCP surface (an optimization like `--core`, not a security boundary): Planner 6 tools / 8.2k chars, Reviewer 5 / 5.4k, Builder/Tester none, vs core 49 / 45k. `wmux role resolve --json` prints the opt-in `mcp.argv` per CLI (claude `--mcp-config` replaces the user-level `wmux` server; codex `-c mcp_servers.wmux.args=[…]` / `enabled=false`; all verified 2026-09-30). The full/core/commander wire baseline is byte-identical (`probe:mcp`). |
| C10 | Settings › Agents › **Token usage**: Balanced/Minimal model+effort profile over the role bindings with an Apply preview (derived, never persisted; permissions never touched), per-role launch + wmux tool count, Deck brain link. en/ko/zh/pl. |
| agy fan-out | **Fan-out launches the agy CLI.** agy refuses a positional prompt, so the swap writes `agy … -i "<prompt>"`; a fresh worktree stops on agy's trust screen, so main lists exactly that task folder in agy's own `trustedWorkspaces` (`~/.gemini/antigravity-cli/settings.json`, the entry the screen itself writes) and prunes vanished sibling task folders; only a folder fan-out is spawning in right now is accepted. agy is selectable in fan-out and in Roles & fan-out. Live 2026-09-30: a Claude pane called `fanout_start` with `agents:[{agent:'agy'}]`, the worktree was pre-trusted, agy ran the prompt, wrote the file and committed. |
| Tool levels | `RoleBinding.tools` = `full` / `core` / `role`. `wmux role resolve --json` reports it (opt-in `mcp` field) and a role-bound pane wmux launches gets it: main splices `--mcp-config <file>` (claude) or `-c "mcp_servers.wmux.args=['…']"` (codex, TOML literals so PowerShell keeps the quotes). |
| Profiles | Token usage has **Full, Coding, Balanced, Minimal**, applied through each agent's grammar (claude model+effort, codex effort, agy model suffix) plus a tool level: Full = best models/high/all tools; Coding = strong planner/medium/core (no browser); Balanced = medium planner/low checkers/role tools; Minimal = lowest effort/role tools. |

## Deferred, with reasons

- **C6** fast `isolate:false` test lane: only ~7 s faster and order-dependent failures (71 vs 30 files, 6 in common).
- **C8** shorter MCP descriptions: upstream pins the exact tools/list bytes per profile; C9 gets the saving additively.
- **C11** shorter orchestrator prompt: built once per brain session and prompt-cached; gating on start-time state
  would leave stale guidance.
- **C12** split `SettingsPanel.tsx`: a fork-only split of upstream's most-edited file conflicts on every update.
- **C3b** fresh context per task: fan-out tasks already start fresh agents; no dispatch point for reused panes yet.

## Validation (2026-09-30)

- Full `test:parallel` from Git Bash: only `webPty.test.ts` fails, as on pure upstream 3.64.0.
  `test:runtime`: only `opencode-sync-render`, failing before these changes too. Typecheck clean. `probe:mcp` green.
- Built with `npm run make` and installed locally (Squirrel 3.63.1 → 3.64.0; the agy fix was applied by replacing
  `app.asar`, same version). Installed CLI `role resolve` prints the `mcp` field; installed bundle `--role=Planner`
  6 tools, `--role=Reviewer` 5, `--core` 49; claude with the Planner tokens sees one `wmux` server with 6 tools; codex
  shows `--role=Reviewer` args. Token usage and Roles & fan-out checked in the installed app (CDP screenshots).
- Live `~/.wmux` and `session.json` backed up before install (`C:\Users\Lontra\wmux-backup-2026-09-30`).
