### Changed

- **A terminal whose mouse wheel reaches nothing now logs why.** While the
  app in a pane tracks the mouse, the wheel goes to the app instead of
  scrolling. If several wheel notches in a row never reach the app, wmux now
  logs one line with the pane's mouse tracking mode, its mouse report format,
  which screen buffer is active, the running agent, and whether the reports
  went out in a format wmux does not forward or were held back by the stale
  mouse-mode guard. It helps confirm the cause of wheel and drag dying in
  long-running Codex panes on Windows. Nothing is handled differently.
