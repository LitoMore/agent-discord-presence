# Presence desktop

The desktop app uses MyGo 0.9.0's native Go UI toolkit. Both the main window and tray panel are drawn directly by the toolkit, without HTML, React, a webview, or a JavaScript frontend. The existing Node service remains shared with the CLI and agent adapters.

## Run

Requirements: Node.js 22+, Go 1.27.4+, and the Discord desktop app for live activity. Dependencies are pinned in the npm and Go lockfiles. Bun and frontend tooling are not required.

From the repository root:

```sh
npm install
npm run desktop:install
npm run desktop
```

Use **Start service** to run the local service in the background and **Stop service** to clear activity and stop it. **Agents → Setup** offers two methods: **Agent prompt** copies a ready-to-paste prompt with local installation details and instructions to preserve existing configuration; **Manual configuration** copies the hook JSON, extension entry, or installation command directly. The selected method is previewed before copying, with confirmation after a successful copy. The app does not overwrite agent configuration files.

The tray icon opens the native quick panel. Its context menu opens the main window or quits the app. Closing either window hides it; quitting closes the bridge worker but leaves the independent presence service running. The macOS development app uses an ad hoc signature.

## Build and verify

```sh
npm test
npm run desktop:check
cd apps/desktop
go test ./...
go tool mygo vet
cd ../..
npm run desktop:build
```

MyGo writes packaged apps to `apps/desktop/build/`. The package includes the compiled service, prompts, presets, package metadata, setup documentation, and agent plugins. Node.js 22+ remains a runtime prerequisite for the shared service. Finder launches locate Node on PATH, `/opt/homebrew/bin/node`, or `/usr/local/bin/node`; set `ADP_NODE` for another installation. Configure release signing and notarization separately before distribution.

## Structure

```text
src/                       Shared Node service, CLI, adapters, and settings
  desktop-protocol.ts      Desktop request and snapshot types
  desktop.ts               Allowlisted desktop actions using the existing core
  desktop-bridge.ts        Persistent JSON-lines worker
apps/desktop/
  main.go                  MyGo windows, lifecycle, tray, and single instance
  bridge.go                Serialized, bounded bridge to the Node worker
  state.go                 Native application model, commands, and image cache
  view.go                  Main window, native forms, dialogs, and tray panel
  mygo.json                Native app configuration and packaged resources
prototypes/                Original interface exploration
```

The backend remains the source of truth. Settings save only on request, invalid configuration files remain untouched, and reset actions preserve unrelated settings. Forms support global and individual agent scopes. The live preview shows the daemon's rendered activity; unsaved appearance changes render locally and are labeled as a preview.

Discord supplies the account name and avatar through its existing RPC handshake, so no account token is needed. Profile customization and asset keys can render differently in the actual Discord client. Application theme preferences are stored separately in the desktop app's user-data directory.
