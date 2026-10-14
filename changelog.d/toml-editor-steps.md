### Changed

- Internal: the TOML key editor behind the Codex config writer edits a key inside a table or an array-table entry with one shared step, and the Codex edit planner plans each kind of item in its own step (cognitive complexity 56, 48, 46 and 74 down to 3, 2, 2 and 11). The planner reuses the editor's key and value formatting and the inventory's path normalization instead of copies. Golden-file tests pin the full outcome first; what is written to `config.toml` is unchanged.
