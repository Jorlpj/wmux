### Fixed

- **A WSL login tab says so when it cannot reach the account directory.** WSL translates a Windows path into Linux only for a drive path or a `\\wsl.localhost\<distro>\…` path into that same distribution. For another distribution or a network share, `wsl.exe` printed "Failed to translate" and dropped the variable, so the login wrote to its default Linux home while Settings kept waiting. wmux no longer forwards such a path: the tab prints which directory WSL cannot reach and stops before the login starts.
