### Added

- **Claude and Codex accounts chosen by quota, like agy's.** Settings →
  Accounts has a "Switch accounts by quota" switch for Claude and for Codex
  (off by default). With it on, a new Claude or Codex pane in a workspace
  whose bound account is out of quota starts on the registered account with
  the most quota left; the workspace binding itself does not change and
  running panes are not touched. When every account is out, the pane says
  when the first one frees up instead of starting an agent that would only
  hit the limit. Claude quota comes from its usage endpoint (no model
  request, refreshed before a launch only when older than 10 minutes);
  Codex quota from the limits Codex records in each account's session files,
  with no network. Codex rows now show the quota left.

### Fixed

- A Claude turn that ends in a pane moved to another account by quota now
  refreshes that account's usage, not only the workspace's bound account's.
