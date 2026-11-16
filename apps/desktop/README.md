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

Use **Start service** to run the local service in the background and **Stop service** to clear activity and stop it. **Agents → Setup → Direct configuration** reads the actual integration file and displays grouped event cards using the same layout as removal. Recommended/lightweight/custom profiles, group-heading toggles, individual event checkboxes, and select-all/clear shortcuts share one scrolling body; a fixed footer shows the selected count and preview/apply actions. Preview additions, retained events, and removals, then confirm **Apply configuration** to reconcile only Presence's integration. Plugin lifecycle and cleanup callbacks remain required; paired optional events are selected together. Hook choices explain their effect on status, summaries, and expiry. Existing summary settings are preserved.

**Agent prompt** copies a ready-to-paste prompt with local installation details, the selected events, and instructions to preserve unrelated configuration. **Manual configuration** copies the selected hook JSON, extension entry, or installation commands. A changed selection must be previewed again before either copying or applying. Copying does not mark the integration installed. Both copy methods confirm successful clipboard writes.

**Agents → ⋯ → Remove integration…** immediately displays checkboxes for installed events, initially unselected. Select individual events, or use **Select all** / **Clear selection**, then **Preview again → Remove selected**. Plugin dependencies remain enforced for partial removal; deleting a plugin entry altogether uses the separate **Remove entire integration** option. The default is the user-level integration path; enter an exact project/custom file path and preview again to change the target. Confirming creates a private backup of an existing file and preserves other hooks and settings. A changed file or selection requires a fresh preview, custom or unsupported code requires manual review, and missing integrations show an explicit empty state. Success displays the backup path and reload instructions. Both CLI and desktop share the same configuration and removal implementation.

Harness selection saves a policy next to the Presence configuration; install/update and reload the plugin through Harness separately. Full Harness removal still uses its plugin manager, while partial removal disables optional policy events. The dialog explains this distinction and does not claim the plugin is installed merely because a policy exists.

**Preferences → Language → Interface language** switches the desktop interface between **English** and **简体中文** immediately, including the tray panel and menu. English is the default. Setup prompts follow the selected interface language. The selection is remembered across restarts and does not change generated summaries or published Discord activity.

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

Discord supplies the account name and avatar through its existing RPC handshake, so no account token is needed. Profile customization and asset keys can render differently in the actual Discord client. Application language and theme preferences are stored separately in `appearance.json` in the desktop app's user-data directory.
