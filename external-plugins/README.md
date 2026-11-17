# External Agent plugins

Agent plugins are installed explicitly from **Agents → Install local plugin…**.
External packages are distributed separately; none are installed by default or
included in the npm package or desktop resources. Core agents, including Pi,
retain their upstream built-in integrations.

Select an external package folder in the picker.
Presence validates `adp-plugin.json` and copies the package into a managed
directory beside its configuration. Removing the source folder does not break
an installed package. Restart the presence service after upgrading its runtime,
then reload the Agent after changing its integration.

Installed plugins appear in the existing Agents list. Their **⋯** menu enables,
disables or removes the package. Disabling or removing a plugin rejects new
events, clears its sessions and cancels pending summaries. Removal keeps saved
settings and Agent-side files. Reinstall by selecting a package folder again.
No plugin is discovered or enabled merely because it exists on disk.

**Remove integration…** previews changes to the Agent's configuration.
Custom files are preserved, and changed files require a fresh preview.
Packages that declare an event policy support scenario selection and partial
removal. Manual integrations show their package-specific setup instructions.

## Package contract (API 1)

```json
{
  "apiVersion": 1,
  "id": "orbit",
  "name": "Orbit Agent",
  "version": "1.0.0",
  "description": "Orbit activity integration",
  "icon": "icon.png",
  "presenceImage": "https://example.com/orbit.png",
  "setup": {"kind": "manual", "instructions": "Load the Orbit adapter."}
}
```

IDs begin with a lowercase letter and contain lowercase letters, digits and
hyphens (64 characters maximum). Core IDs and duplicate display names are
reserved. Files must stay inside the package: no absolute entry paths or
symlinks, at most 256 entries and 8 MB. PNG and SVG icons are limited to 128 KB.
Up to 16 local plugins may be installed. Manifest discovery does not execute code.
Agent adapters and summary workers execute with the user's local permissions.

Adapters use `Reporter` or `emit` from `agent-discord-presence/plugin-sdk` and send
protocol version 1 events using their declared ID. Installed and enabled IDs
participate in the shared session, presence, model and settings pipeline.
Adding another ID requires no Go changes or rebuild.

An optional `summaryWorker` points to JavaScript. Presence runs it with Node,
sends `{model, provider, input: {systemPrompt, prompt, schema}}` on stdin, and
validates a JSON `{topic, subtitle}` response on stdout. Output, runtime and
cancellation are bounded. Workers must honor `ADP_SUMMARY_WORKER=1` to avoid
reporting summary calls as user activity.

Manual host installers declare `setup.kind: "manual"` and an optional argv array
such as `setup.command: ["orbit", "install", "{pluginRoot}"]`.
Presence substitutes the managed package directory as one quoted argument for
the current shell and displays the command; it never executes it during discovery.
Installation writes an SDK binding into each managed copy, which native entries
can load when activated by their host. Host command names belong to packages.

Packages may declare `locales: {"zh-CN": {"English source": "翻译"}}`.
The desktop uses these messages only for that Agent's metadata, event descriptions,
setup instructions and removal instructions. Missing translations use the English
source. Application labels and other plugins' messages cannot be overridden.
Copied setup prompts use the requested language; event IDs and commands stay stable.
Saved configuration scopes may exist before installation or after removal; only
installed, enabled plugins may report events.

Plugins can opt into managed configuration by declaring `integration.kind:
"policy"`, an `integration.events` catalog, and `integration.removalInstructions`.
Each event declares `id`, `capability`, `description`, `required`, `requires`, and
an optional host `source`. The SDK's `adapterEvents(id)` reads the selected IDs
from `integrations/<id>.json` beside the Presence configuration. The plugin must
filter host events with that selection. Missing policies use all events; invalid
policies enable only required events. After applying changes, restart or reload
the Agent-side plugin. Partial removal preserves required callbacks and unrelated
policy fields, backs up existing files, and checks preview revisions. Full
uninstallation from a host plugin manager follows the package's instructions.
