### Added

- **Several Antigravity (agy) accounts, picked by quota.** Settings → Accounts
  now lists agy accounts. agy keeps one sign-in for the whole computer, so
  wmux saves each account's sign-in in the Windows Credential Manager and
  switches the active one. Before wmux starts agy (role launches, fan-out
  tasks) it keeps the active account while it has quota and otherwise moves
  to the account with the most quota left. When every account is out, agy is
  not started and the pane says when the first account frees up, instead of
  sending work that would only fail with another quota error. Quota comes
  from the agy statusLine sensor, which now keeps one snapshot per account;
  a quota error printed in an agy pane also puts that account on cooldown.
  Windows only.

### Fixed

- **Closing a task removes its worktree completely.** A shell or agent still
  running inside the worktree is stopped first, so it no longer holds files
  that left part of the folder behind on Windows.
