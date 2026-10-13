### Changed

- Internal: tests that pin the daemon's own RPC surface (every method `src/daemon/index.ts` registers on the daemon pipe) and the resume-binding writer's guards from #1738, #1823, #771, #230 and #1627, run against the real bundled daemon. Tests only; no behaviour change.
