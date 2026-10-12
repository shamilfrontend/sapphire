# Gulp -> Vite/Node Task Matrix

This file documents the build contract moved from gulp tasks to the new `scripts/build/main.mjs` runner.

## Core Compile/Watch

- `compile` -> `main.mjs run compile`
- `compile-client` -> `tasks/compile.mjs::compileClientTask`
- `transpile-client-esbuild` -> `tasks/compile.mjs::transpileClientEsbuildTask`
- `watch-client` -> `tasks/compile.mjs::watchClientTask`
- `watch` -> `main.mjs` parallel orchestration of `watch-client` + `watch-extensions`

## Extensions

- `compile-extensions` -> `tasks/extensions.mjs::compileExtensionsTask`
- `watch-extensions` -> `tasks/extensions.mjs::watchExtensionsTask` + media watcher
- `compile-extension:<name>` -> `tasks/extensions.mjs::compileExtensionByName`
- `watch-extension:<name>` -> `tasks/extensions.mjs::compileExtensionByName(..., true)`
- `compile-extension-media` -> `tasks/extensions.mjs::compileExtensionMediaTask`
- `compile-extensions-build` -> `tasks/extensions.mjs::compileExtensionsBuildTask`
- `extensions-ci` -> `compileNonNativeExtensionsBuildTask + compileExtensionMediaBuildTask`
- `extensions-ci-pr` -> `compileExtensionsBuildTask(pullRequest=true) + compileExtensionMediaBuildTask`

## Vite Bundles

- `minify-vscode` -> `tasks/viteBundle.mjs::bundleDesktopTask(minify=true)`
- `minify-vscode-reh` -> `tasks/viteBundle.mjs::bundleRehTask(minify=true, withWeb=false)`
- `minify-vscode-reh-web` -> `tasks/viteBundle.mjs::bundleRehTask(minify=true, withWeb=true)`
- `bundle-vscode-web`/`minify-vscode-web` -> `tasks/viteBundle.mjs::bundleWebTask`

## Packaging

- `vscode-web-min-ci` -> `compile-build -> compile-web-extensions-build -> bundleWeb(min) -> packageWeb`
- `vscode-<platform>-<arch>[-min][-ci]` -> `compile/build graph -> bundleDesktop -> packageDesktop`
- `vscode-reh(-web)-<platform>-<arch>[-min][-ci]` -> `compile/build graph -> bundleReh -> packageReh`

## Artifacts Contract

- `out/`: dev compile output for desktop runtime
- `out-build/`: production compile output + `date` marker
- `out-vscode*`: Vite bundled desktop/runtime artifacts
- `out-vscode-web*`: Vite bundled web artifacts
- `.build/extensions`: packaged builtin/local extensions
- `.build/web/extensions`: packaged web extensions

## Compatibility Notes

All CI-facing build tasks now route through `scripts/build/main.mjs` without invoking `gulp` CLI.
