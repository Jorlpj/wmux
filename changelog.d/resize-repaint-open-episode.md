### Fixed

- **Opening a workspace no longer lights an idle pane running when its last
  turn was interrupted, or right after an agent drew its start screen.** The
  earlier fix for the resize redraw still let it through on a pane whose turn
  no Stop had closed, so its dot could show running for up to two minutes.
