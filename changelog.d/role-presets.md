### Added

- **Builder and Tester presets in Roles & fan-out.** Each of the two rows has an "Apply preset" button that writes a ready-made binding for that role: Builder runs at high effort and Tester at medium, both with skip permissions on, keeping the agent and extra args you set (agy when the role is unbound). Because the settings live on the role rather than the provider, Builder and Tester can both use Antigravity (agy) and still differ. agy has no per-launch flag for MCP servers, skills or hooks, so those stay shared in Token usage.
