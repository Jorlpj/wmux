### Changed

- Internal: the resumed-worker idle tests and the worker clear tests wait for the reclaimed-workers store's last write before deleting their temp folder. On Node 22 (the Cross-Platform Baseline) a write that landed mid-removal failed the teardown with ENOTEMPTY, so the test passed only on retry. `ReclaimedWorkers` gains `flush()`, as the other factory stores have. Tests only; no behaviour change.
