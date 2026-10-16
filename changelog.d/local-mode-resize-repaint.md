### Fixed

- **An idle pane no longer shows as running after its workspace is opened
  when its terminal runs without the daemon.** Before, the screen redraw after
  the resize lit the running dot for up to two minutes. Daemon panes got this
  fix earlier; this covers the local fallback used when the daemon could not
  connect.
