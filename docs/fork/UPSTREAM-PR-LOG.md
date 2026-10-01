# Contribution log: everything since PR #1677

Scope: 69 commits on top of upstream `main` (the last merged contribution was #1677, "model discovery, effort and
launch options"; before it #1659, "Agy support"). Verified on Windows 11 with Claude Code 2.1.x, Codex 0.159.x and
Antigravity CLI (`agy`) 1.2.14.

## 1. agy (Antigravity CLI) must run in a worktree — what we found

This is the finding most worth reading.

- **agy has no ignore mechanism.** Probed with a canary file: agy still read it when it was listed in `.gitignore`,
  `.geminiignore` or `.agyignore`, when it was an absolute path outside every `--add-dir`, with `--sandbox=true`
  (the sandbox restricts the terminal, not file reads) and with `--mode plan` (plan mode blocks edits, not reads).
  Anything in its workspace can be read and sent to the model provider.
- **A git worktree is the working mitigation.** A worktree never contains gitignored trees, so agy launched there
  simply cannot list them. Live check: agy listing `third_party/` from a worktree saw only the two tracked entries.
  It reduces exposure; it is not a guarantee, because an explicit absolute path is still readable.
- **It also turned out to be very efficient.** fan-out already gives every task its own worktree, so agy runs
  isolated, in parallel, and its commits land on a throwaway branch. Live run: a Claude pane called `fanout_start`
  with `agents:[{agent:'agy'}]`; the worktree was pre-trusted, agy ran the prompt, wrote the file and committed.
- **Two blockers had to be solved for agy to work there:**
  1. agy refuses a positional prompt ("Prompts are read only from -p/--print, -i/--prompt-interactive, or stdin"),
     so the launch is rewritten to `agy -i "<prompt>"`, which runs the prompt and keeps the session open.
  2. A fresh worktree stops on agy's "Do you trust…" screen. wmux now lists exactly the task folder in agy's own
     `trustedWorkspaces` (the entry the screen itself writes) and prunes vanished sibling folders. Only a folder
     fan-out is spawning right now is accepted.
- **No per-launch config for agy.** `agy --help` has no flag for MCP servers, skills or hooks, so those stay a global
  surface (`~/.gemini/config`). Per-role differences for agy therefore live in the role binding (model, effort,
  permissions), which is what the new presets use.

## 2. What was added

**Role presets (latest change).** Roles & fan-out: "Apply Builder preset" / "Apply Tester preset". Builder = high
effort, Tester = medium, both with skip permissions, keeping the chosen agent and extra args (agy when unbound).
Builder and Tester can both run on agy and still differ. Pro models (no `-medium`) move to Flash. en/ko/zh/pl, tests.

**Token usage tab.**
- Provider quota cards for Claude, Codex and agy (percent used, reset time, plan, credits), refreshed only on open or
  on click, never by polling. Codex falls back to the limits it records in its own session files.
- Average tokens per message from local Claude and Codex transcripts.
- Four profiles (Full, Coding, Balanced, Minimal) writing model, effort and wmux tool level into the role bindings,
  with a preview. Role-bound panes that wmux launches get the tool level too.
- A Custom panel to toggle MCP servers (and single tools), skills, plugins, hooks and built-ins per CLI, with
  preview, backups before write, drift detection and saved surface profiles.
- Safe config writer: atomic writes, timestamped `*.bak-wmux-*` backups, comment-preserving TOML edits, re-parse
  verification and rollback. Writers for Codex, Claude and agy.
- An agy quota sensor (`quota-sink.js`) that chains an existing `statusLine` instead of replacing it and captures
  only quota, plan, model and context metrics.
- Per-target MCP Register, including opt-in agy, and an MCP status section.

**Roles, fan-out and MCP.**
- `--role=<Role>` MCP surface (Planner 6 tools, Reviewer 5, Builder/Tester none) and `wmux role resolve --json`.
- `RoleBinding.tools` = `full` / `core` / `role`.
- agy selectable in Roles & fan-out and in fan-out.

**Deck hygiene and tooling.** Vitest isolated from the live `~/.wmux`; orphan Deck state reconciled at startup;
`wmux deck state --orphans/--prune`; `npm run test:agent`, `test:changed`, `typecheck:quiet`.

## 3. Validation

Typecheck clean. New and affected vitest files pass (2008 tests in shared/Settings/i18n). One pre-existing
symlink-permission test (`settingsFile.test.ts`) fails on Windows without symlink rights and is untouched here.
The installed build was checked by hand earlier (Token usage and Roles & fan-out screens).

## 4. Next

Antigravity **login** is not supported yet; that is the next piece we will implement.

Thank you for wmux. We hope everyone enjoys this contribution.

— Lontra (JLPJ)
