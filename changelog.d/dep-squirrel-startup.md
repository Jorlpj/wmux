### Changed

- Internal: removed the unused `electron-squirrel-startup` dependency and its type package (the Windows installer events have been handled directly in `src/main/squirrel.ts` since March), and declared the three packages `forge.config.ts` imports but `package.json` did not list (`@electron-forge/shared-types`, `@electron/asar`, `@electron/osx-sign`), at the versions already installed. `THIRD_PARTY_NOTICES` regenerated. No behaviour change.
