### Changed

- **One reader for stored removed hooks.** The Token usage inventory and the
  Claude hook writer each had their own copy of the code that reads a removed
  hook's handler from the surfaces store, and the inventory kept its own deep
  comparison. Both now use one shared helper and the shared `deepEqual`. No
  behaviour change.
