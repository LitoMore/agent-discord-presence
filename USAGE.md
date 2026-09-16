# Usage guide

[Back to README](README.md)

- [Run the service](#install-and-run)
- [Prompts and language](#default-presence-prompts)
- [Automatic summaries and models](#automatic-generation-and-model-selection)
- [Images and display settings](#images-and-display-settings)
- [Presence layout and manual summaries](#summary-title-layout)
- [Connect your agents](#connect-your-agents)
- [Session selection](#session-selection-and-lifecycle)
- [Configuration and platforms](#configuration-and-platform-notes)
- [Development](#development)

Commands below use `adp`, the short alias for `agent-discord-presence`. To run from source, see [Development](#development).

## Install and run

Requires Node.js 22 or newer and the Discord desktop app. Install from npm:

```sh
npm install --global agent-discord-presence
```

Start the service in a terminal (keep it running):

```sh
adp start
```

To start in the background and continue using the same terminal:

```sh
adp start -b
```

The command returns after the local service is listening and prints its PID and log path. Discord may still be connecting; check `adp status` for connection state. Startup failures return a nonzero exit code, including when a service is already running. The detached process continues after the terminal closes; use `adp stop` to shut it down. Background mode inherits the current environment and supports the same startup options, including `--socket` and `--dry-run`. Its output is appended to the printed log file in the per-user temporary directory.

The default Application ID, `1549160807705870418`, is defined in `src/constants.ts`. You can supply another Application ID with `--client-id` or `DISCORD_CLIENT_ID`. Create an application in the [Discord Developer Portal](https://discord.com/developers/applications) and copy its Application ID from General Information. A bot token or user token is not required. The activity explicitly sets its `name` to the session summary, independently of the application's Developer Portal name.

For a preview without Discord:

```sh
adp start --dry-run
```

In another terminal, send sample lifecycle events:

```sh
printf '%s\n' '{"session_id":"demo","hook_event_name":"UserPromptSubmit"}' | adp hook codex
adp status
printf '%s\n' '{"session_id":"demo","hook_event_name":"SessionEnd"}' | adp hook codex
```

Stop the service from another terminal:

```sh
adp stop
```

This cancels pending summary generation, clears Discord activity, and closes the service socket. If the service is already stopped, the command reports that and succeeds. For a custom socket, use `adp stop --socket PATH` or the same `AGENT_PRESENCE_SOCKET` used to start the service.

Ctrl+C in a foreground service terminal also closes it and clears its activity. Startup defaults to the foreground; use `--background` or `-b` to detach it. Background mode does not configure startup at OS login or restart after a crash. A service started with an older version must be restarted once to support the new stop command.

## Independent configuration for each agent

One daemon accepts Codex, Claude Code, OpenCode, Pi, and DeepSeek Harness sessions concurrently. Install each client's hook/plugin once; incoming events automatically select that agent's settings. Discord shows one selected session at a time, using the existing activity priority and pinning rules.

Configuration consists of built-in agent icon defaults, shared settings, and optional `agents` overrides, in that precedence order. Existing flat configuration remains valid. Use `--agent` to change just one client:

```sh
adp config set service session --agent codex
adp config set model '' --agent codex
adp config set customPrompt 'Write summaries in English.' --agent codex
adp preset apply codex --agent codex

adp config set service session --agent deepseek-harness
adp config set model '' --agent deepseek-harness
adp config set provider '' --agent deepseek-harness
adp config set customPrompt '用中文描述当前工作。' --agent deepseek-harness
```

With `service: session` and empty model/provider overrides, each client uses its own session model. Harness also reuses its in-process provider credentials. You can independently configure `enabled`, `service`, `model`, `provider`, `baseUrl`, `apiKeyEnv`, `customPrompt`, `maxLength`, and all `presence` fields. `enabled` controls automatic summaries, not lifecycle reporting.

Inspect effective settings or remove an override:

```sh
adp config show --agent codex
adp config show --agent deepseek-harness
adp config unset customPrompt --agent codex
```

`unset --agent` restores inheritance from the global setting. Setting an empty model explicitly selects the session model even if a global model override exists. Without `--agent`, commands continue to change shared defaults. Nested objects such as `presence.assets` merge; arrays and explicit `null` replace inherited values. Saved overrides contain only fields you set, so future global changes still reach inherited fields.

For example, one configuration file can contain:

```json
{
  "service": "session",
  "agents": {
    "codex": {
      "customPrompt": "Write summaries in English.",
      "presence": {"name": "Codex: {topic}"}
    },
    "deepseek-harness": {
      "customPrompt": "用中文描述当前工作。",
      "presence": {"name": "DeepSeek: {topic}"}
    }
  }
}
```

Settings reload automatically. After upgrading the daemon code, restart it once. `adp status` includes effective `agentSettings` for connected agents. Summary-policy changes discard obsolete work for affected agents; changing only another agent's overrides leaves their work intact.

## Configuration presets

Presets in [`presets.json`](presets.json) can contain any supported settings: prompt preferences, model/service selection, summary enablement, and `presence` fields such as images, buttons, text, and timers. Each preset is a partial settings object:

```json
{
  "codex": {
    "customPrompt": "Use concise English",
    "maxLength": 60,
    "presence": {
      "assets": {
        "large_image": "https://cdn.jsdelivr.net/npm/@lobehub/icons-static-png@1.97.0/dark/codex.png",
        "large_text": "Codex"
      }
    }
  }
}
```

```sh
adp preset list
adp preset show codex
adp preset apply codex --agent codex
adp preset apply minimal
```

`show` previews without writing. `apply` validates and saves the merged settings to the same user config as `config set`. Nested objects merge, omitted fields remain unchanged, and arrays or `null` replace the existing value. For example, applying `codex` preserves an existing small image and model override. Invalid presets leave the config untouched. To clear images, use `"presence": {"assets": null}`; to clear buttons, use `"presence": {"buttons": []}`. Applying `default` resets only `customPrompt`, not all settings.

The bundled presets are `default`, `minimal`, `playful`, `codex`, `claude-code`, `opencode`, `pi`, and `deepseek-harness`. Each agent automatically gets its matching preset’s large image and hover label. These image defaults sit below explicit global settings and per-agent overrides; preset prompt/model fields are not applied automatically. Use `adp preset apply deepseek-harness --agent deepseek-harness` to explicitly save an agent’s image preset. Icon assets come from [Lobe Icons](https://github.com/lobehub/lobe-icons), pinned to version 1.97.0. To add bundled presets when developing from source, edit `presets.json`; the file is included in the npm package. For persistent personal settings, use `adp config set`. Existing string-valued prompt presets must be converted to objects such as `{"customPrompt": "..."}`. `adp prompt NAME` still previews only the prompt-related fields, without applying the preset. Saved presentation settings update in the running service without a restart; model settings affect new summary jobs.

## Default presence prompts

The package includes a default activity-writing prompt in [`prompts/presence.md`](prompts/presence.md), editable preferences in [`prompts/default.json`](prompts/default.json), and configuration presets in [`presets.json`](presets.json).

Automatic summaries are enabled by default. After a completed reply, the adapter sends at most 4,000 Unicode characters of assistant text to the local service. A background worker uses this prompt to generate the activity title and subtitle. It never reads transcript files. These prompts generate activity text, not full plugin settings such as images, buttons, or timers.

Print the complete system prompt, configuration, and JSON output schema:

```sh
adp prompt
adp prompt minimal
adp prompt playful
```

The default produces a short English action phrase (`topic`) and a complementary `subtitle`, limited to 72 characters each. The subtitle can be empty. Language and tone can be changed through `customPrompt`; output structure, length, accuracy, and public-information constraints remain in effect. For example:

```json
{
  "customPrompt": "Use concise, natural English. Focus on the goal and avoid emoji.",
  "maxLength": 72
}
```

Expected output shape (illustrative, not generated from your current session):

```json
{
  "topic": "Debugging Discord presence updates",
  "subtitle": "Checking recovery after reconnecting"
}
```

For other model integrations, `buildPresencePrompt` is exported from `agent-discord-presence/prompts`. It accepts `{agent, response}` and optional `{customPrompt, maxLength}`, and returns `{systemPrompt, prompt, schema}` without invoking a model itself. Input is capped at 4,000 Unicode code points and output limits can be set from 20 to 120 characters. A caller must still validate model output, discard stale results from other sessions, and retain lifecycle labels on failure. Prompt instructions alone do not enforce output validity or privacy.

The action-phrase/subtitle approach and custom-style behavior were inspired by [Cola Discord Presence's generation prompt](https://github.com/LitoMore/cola-plugin-discord-presence/blob/main/src/index.ts). The defaults here are written for multiple coding agents and distinguish planning, implementation, and verified results.

### Automatic generation and model selection

Default behavior is `service: "session"` with an empty `model` override. The worker reuses the installed agent CLI, or the in-process Harness LLM service, with the model ID reported by the current session. It does not silently substitute a model if that ID is missing; the previous summary remains visible. CLI worker failures appear in `adp status`; Harness auxiliary failures are contained in the plugin. An explicit `model` overrides the session model.

| Agent | Reply source and trigger | Native generation |
| --- | --- | --- |
| Codex | `Stop.last_assistant_message`; model from hook input | Logged-in `codex exec`, ephemeral session, read-only sandbox, hooks/plugins and execution tools disabled |
| Claude Code | `Stop.last_assistant_message`; model retained from hook input | `claude -p --safe-mode`, no tools or persisted session |
| Pi | Assistant text blocks, submitted at `agent_settled`; model/provider from context | `pi --print`, no tools/extensions/skills or saved session |
| OpenCode | Assistant message text parts, submitted at idle; model/provider from message metadata | `opencode run`, all tool permissions denied; summary runs appear in OpenCode session history |
| DeepSeek Harness | Completed assistant text, submitted at actual idle; model/provider from message source | In-process `ctx.llm.stream`, reusing Harness provider credentials; no tools or conversation history |

For CLI-based adapters, the native CLI must be available to the service and already authenticated. Current CLI flags are required; in particular Claude Code must support `--safe-mode`. Model definitions or credentials available only inside an agent's project may not be available in the worker's temporary working directory. Codex workers skip the user config to avoid inheriting unrelated MCP integrations; custom Codex model-provider definitions should use the explicit API service below. This follows the session model ID, not its reasoning effort or the entire original conversation.

Codex native generation has been verified live using the current session's `gpt-6-astra` model. Claude Code, Pi, and OpenCode native process invocation still need live verification on those clients; their event-to-generation paths are covered by integration tests.

Configure from a terminal, including a terminal invoked by your coding agent:

```sh
adp config show
adp config set customPrompt 'Use concise, natural English without emoji'
adp config set maxLength 72
adp config set model ''             # follow the current session model
adp config set enabled false        # stop scheduling new summaries
adp config set enabled true
```

Settings are saved to `~/.config/agent-discord-presence/config.json`, respecting `XDG_CONFIG_HOME`, or `ADP_CONFIG` when set. New generation jobs read updated settings without restarting the daemon. Already-running jobs may finish using their previous settings. The default prompt is English; the conversation language does not automatically select the summary language. Phase labels such as Working remain English.

To use a separate OpenAI-compatible Chat Completions service:

```sh
adp config set baseUrl 'https://your-provider.example/v1'
adp config set model 'your-model-id'
adp config set apiKeyEnv 'PRESENCE_API_KEY'
adp config set service 'openai-compatible'
```

Set `PRESENCE_API_KEY` in the **service process's environment**, then start/restart the service. Only the environment variable name is saved in the config, never the key. For local servers without authentication, set `apiKeyEnv` to an empty string and use a localhost HTTP URL. Remote services require HTTPS. The service must accept `/chat/completions` with `response_format: {"type":"json_object"}`. The plugin validates both returned fields and the configured length limit.

For a native Pi/OpenCode provider override, keep `service` as `session` and set `provider` and `model` to that agent's identifiers. Restore session defaults with:

```sh
adp config set service session
adp config set model ''
adp config set provider ''
```

Generation is serialized, limited to one active request with a bounded queue, and times out after 60 seconds. Duplicate completions are coalesced. New work, closed/expired sessions, or manual summary edits invalidate pending results. Generation failures keep the previous title; `adp status` includes job counts and a diagnostic without model input or provider stderr. Dry-run mode does not call models by default. Native summary subprocesses set a recursion guard so their own Presence adapters cannot create more summary jobs.

Assistant text is transient in this service: it is not stored in session state or printed by status. The chosen provider receives it, and native CLIs may maintain their own logs/history as described above. The prompt requests public wording and omission of sensitive details; text/schema validation is not a guarantee of semantic redaction.

From a built source checkout, a live generation smoke check uses public fixture text and a private dry-run service, without publishing the fixture to Discord:

```sh
node scripts/smoke-generation.mjs CURRENT_MODEL_ID
```

### Images and display settings

All display overrides live under `presence` in the same user config. Use `adp config set` with a dotted key, or provide a JSON object for a whole section. Changes are picked up by the running service within about a second, then sent at the Discord update interval (normally up to five seconds). Invalid file edits keep the last valid configuration; `adp status` reports `settingsError`.

Set large and small images and their hover text:

```sh
adp config set presence.assets.large_image 'https://example.com/presence.png'
adp config set presence.assets.large_text '{topic}'
adp config set presence.assets.small_image 'my-agent-icon'
adp config set presence.assets.small_text '{agent}'
```

Replace the example URL with a publicly accessible HTTPS image URL. Local paths and data URLs are not supported. Alternatively, use an asset key uploaded to the **same Discord application** selected by `--client-id` or `DISCORD_CLIENT_ID`. Asset keys belong to that application's owner; users of the built-in application can use external image URLs or select their own application. Discord documents [external images and application assets](https://docs.discord.com/developers/rich-presence/using-with-the-embedded-app-sdk#using-external-custom-assets). Image loading and rendering depend on the Discord client.

| Setting | Value and default behavior |
| --- | --- |
| `presence.name` | Title text or template; defaults to `{topic}` |
| `presence.details` | Detail text or template; defaults to `{phase}`; `null` hides it |
| `presence.state` | State text or template; defaults to `{subtitle}`; `null` hides it |
| `presence.type` | `0` Playing (default), `2` Listening, `3` Watching, `5` Competing |
| `presence.status_display_type` | `0` name, `1` state, or `2` details for the compact activity label |
| `presence.details_url`, `presence.state_url` | HTTPS links attached to the corresponding text |
| `presence.assets.large_image`, `presence.assets.small_image` | Public HTTPS image URL or application asset key |
| `presence.assets.large_text`, `presence.assets.small_text` | Hover text or template |
| `presence.assets.large_url`, `presence.assets.small_url` | HTTPS links attached to the images |
| `presence.timestamps` | JSON object with `start` and/or `end` in Unix **seconds**; `start` also accepts `"session"`; `null` hides the timer |
| `presence.buttons` | JSON array of up to two `{label, url}` objects; URLs must use HTTPS |
| `presence.party` | Optional JSON object with `id` and/or `size: [current, maximum]`; `null` removes it |

Text templates support `{topic}`, `{subtitle}`, `{agent}`, `{phase}`, and `{state}` (the raw lifecycle state). Only text fields and button labels expand templates; URLs and asset keys stay literal. Fixed text takes priority over generated summaries. With no summary, `{topic}` falls back to `Coding with AGENT` and `{subtitle}` to `AGENT session`. Removing an override restores the original automatic layout.

```sh
adp config set presence.name '{agent}: {topic}'
adp config set presence.details 'Working on a personal project'
adp config set presence.state null
adp config set presence.type 3
adp config set presence.timestamps null
adp config set presence.buttons '[{"label":"Project","url":"https://example.com"}]'
```

For elapsed session time or a countdown:

```sh
adp config set presence.timestamps '{"start":"session"}'
# Replace with your desired future Unix timestamp in seconds:
adp config set presence.timestamps '{"end":2000000000}'
```

Reset individual overrides or the entire display configuration:

```sh
adp config unset presence.assets.small_image
adp config unset presence.name
adp config unset presence.timestamps
adp config unset presence
```

Setting `presence.assets` to `null` removes both images; setting `presence.buttons` to `[]` removes buttons. Text is limited to 128 Unicode characters and button labels to 32; expanded templates are truncated at those limits. Configuration persists across restarts, while generated summaries remain in memory. Manual display updates do not invoke a model. The summary `customPrompt` controls generated text only; image URLs and other settings can be configured by asking your coding agent to run these commands.

These are display controls, not Discord account settings. Streaming/custom-status activity types and interactive game join/spectate actions are not implemented. Discord controls the final rendering, and newer link/display fields may vary by client version. See the [Discord activity field reference](https://docs.discord.com/developers/events/gateway-events#activity-object) for platform behavior.

### Summary title layout

The activity card uses a summary-first layout:

| Discord field | Content |
| --- | --- |
| `name` (title) | Summary `topic`, without an application-name prefix |
| `details` | Current lifecycle phase, such as Working or Waiting for input |
| `state` | Complementary `subtitle`, or e.g. Codex session when absent |
| `timestamps.start` | Observed session start time |

For example: **Debugging Discord presence updates** / Working / Checking recovery after reconnecting. Without a summary, the title falls back to `Coding with Codex` (or the current agent). A summary stays visible while the session is idle, until explicitly replaced, cleared, or the session ends. It is held in memory and does not survive a service restart.

Use the exact session key from `status` to publish text already prepared for public display:

```sh
adp status
adp summary 'codex:SESSION_ID' 'Debugging Discord presence updates' 'Checking recovery after reconnecting'
adp clear-summary 'codex:SESSION_ID'
```

The topic is required; the subtitle is optional. Duplicate subtitles are omitted. Both fields are bounded to 120 Unicode characters; the default generation prompt uses the stricter 72-character limit. Text is deliberately supplied separately from raw hooks; user prompts and assistant responses are not automatically treated as public summaries.

Model integrations can import `summaryTarget` and `publishSummary` from `agent-discord-presence`. Capture `summaryTarget(key)` **before** generation, then pass that target and validated `{topic, subtitle}` output to `publishSummary`. The daemon rejects updates after the target session has changed or closed. Summaries never change session selection priority or extend the session's liveness timeout. Use fresh source context to regenerate after a stale-target rejection.

## Connect your agents

Start the shared service before using any adapter. Use one installation method per agent to avoid duplicate hooks. The `config codex|claude-code|opencode|pi` commands only print adapter configuration; `config set` saves this plugin’s summary settings. Generated configuration uses absolute paths to the installed package and, for hooks, the Node.js executable. Regenerate it if either location changes, such as after switching Node.js installations.

### Codex

Generate hooks with absolute executable paths:

```sh
adp config codex
```

Merge the generated `hooks` entries into `~/.codex/hooks.json` (or the project's `.codex/hooks.json`). Preserve existing hooks. In Codex, open `/hooks` and review/trust the new hooks, then start a new session.

A distributable plugin is also included at `plugins/codex/agent-discord-presence`. The package directory is `agent-discord-presence` inside the global modules directory shown by `npm root --global`. It uses the default `hooks/hooks.json` discovery convention. Its commands require `agent-discord-presence` on PATH, provided by the global npm installation above. Add the plugin to your own Codex plugin marketplace; marketplace registration is not automatic.

### Claude Code

```sh
adp config claude-code
```

Merge the generated `hooks` entries into `~/.claude/settings.json` (or project `.claude/settings.json`), preserving existing settings. Restart Claude Code.

Alternatively, after the global npm installation above, load the bundled plugin (POSIX shell):

```sh
claude --plugin-dir "$(npm root --global)/agent-discord-presence/plugins/claude-code/agent-discord-presence"
```

### OpenCode

```sh
adp config opencode
```

Save the printed export statement in `~/.config/opencode/plugins/agent-presence.ts` or `.opencode/plugins/agent-presence.ts`, creating the directory if needed. Restart OpenCode. The adapter uses OpenCode's `event` subscription and handles `session.status`, `session.idle`, `session.error`, and permission events. It works with the documented plugin API at `opencode.ai/docs/plugins/`; compatibility with a different major plugin API should be checked before upgrading.

### Pi

For a one-off session using the globally installed package (POSIX shell):

```sh
pi -e "$(npm root --global)/agent-discord-presence/dist/adapters/pi.js"
```

For automatic loading:

```sh
adp config pi
```

Save the printed export statement in `~/.pi/agent/extensions/agent-presence.ts`. Reload extensions or restart Pi. The npm package also declares its extension in the `pi.extensions` metadata.

Pi must provide `agent_settled`, `ui_prompt_start`, and `ui_prompt_end` events. Older Pi versions that only emit `agent_end` are not supported: that event may precede automatic retry, compaction, or queued continuation, and would report idle too early.


### DeepSeek Harness

The package is a Harness bundle containing a Cordis plugin. Build a local checkout before installing it:

```sh
npm run build
dsh plugin --profile web add /absolute/path/to/agent-discord-presence
adp start -b
```

Restart Harness using that profile. Once this package version is published, use `dsh plugin --profile web add agent-discord-presence` instead. Replace `web` with your own profile name. Remove it with `dsh plugin --profile web remove agent-discord-presence`.

The plugin tracks live `agent/status` transitions, approval audit events, errors, and agent disposal. It waits for actual idle before submitting completed assistant text, ignores reasoning and tool output, and closes all reporters on plugin unload. Concurrent sessions have independent state. Approval requests display Waiting; other interactive tools remain Working.

Automatic summaries use the default `session` service: the plugin calls Harness’s registered LLM service with the current reply’s model and provider, reusing Harness’s configured credentials. No separate API key, endpoint, or OpenAI-compatible configuration is needed. Calls contain only the bounded completed reply and presence prompt, with no tools or conversation history. Explicit `model`/`provider` overrides still apply; selecting `openai-compatible` delegates generation to the daemon’s configured service instead.

Native summaries run one at a time per plugin instance with a bounded queue and a 60-second deadline. New work, errors, agent disposal, and plugin unload cancel obsolete work. The daemon rejects results after session changes, manual summary edits, or summary configuration changes. Disabling automatic summaries preserves lifecycle presence. Native calls do not contribute to the daemon CLI worker counters.

The adapter contract was checked against official Harness commit `0d1f50007f9bca3f52b06e1c3074fa14d5fb0720`; lifecycle integration tests use a simulated host and local daemon, not a live Harness/Discord connection. See the [official bundle installation contract](https://github.com/deepseek-ai/deepseek-harness/blob/0d1f50007f9bca3f52b06e1c3074fa14d5fb0720/docs/user/develop/basic/publish.md).

## Session selection and lifecycle

```sh
adp status
adp pin 'codex:SESSION_ID'
adp unpin
```

Copy an exact session key from `status`. Working/waiting sessions rank above errors, then idle sessions. Within a rank, the most recently updated session wins. Heartbeats do not change that ordering. Elapsed time measures the observed session lifetime, including idle time, rather than billable agent execution time.

OpenCode, Pi, and DeepSeek Harness adapters send a heartbeat every 20 seconds with their host PID. The service removes their sessions after 90 seconds without a heartbeat or when that process exits. OpenCode disposal, Pi shutdown, and Harness plugin unload stop their timers. A daemon restart recovers extension sessions on the next heartbeat.

Command hooks are short-lived and do not provide a trustworthy host PID, so Codex and Claude Code use lifecycle end events plus a 30-minute silence timeout. Change it with `start --stale-minutes 60`. A long silent model request can exceed that timeout; increase it for long-running work. Hooks resume reporting on the next lifecycle event after a daemon restart. Focus changes are not tracked.

`PermissionRequest` reports waiting; subsequent tool/turn events restore activity. A permission rejected without a follow-up event may remain waiting until another lifecycle event or expiry. Hook start timestamps suppress older arrivals, but hooks do not expose a universal sequence number; simultaneous events and other hooks that continue a `Stop` can cause transient state inaccuracies. This adapter is an activity indicator, not a scheduler or accounting source.

## Configuration and platform notes

| Setting | Purpose |
| --- | --- |
| `--client-id` / `DISCORD_CLIENT_ID` | Discord application ID |
| `--socket` / `AGENT_PRESENCE_SOCKET` | Override the local service socket; use the same path in agents and daemon |
| `DISCORD_IPC_PATH` | Override Discord socket discovery, useful for sandboxed Discord installs |
| `--stale-minutes` | Hook inactivity timeout, 1–1440 minutes |
| `--dry-run` | Print activity JSON instead of connecting to Discord |

The runtime has no production npm dependencies. Unix uses a per-user directory and a mode-0600 socket; Windows uses a named pipe. These interfaces are for trusted local processes. Do not expose them directly to the network. macOS/Linux socket transport is covered by automated tests; Windows pipe support needs testing on Windows. The absolute-path hook generator currently targets POSIX shells; use the bundled PATH-based hooks on Windows.

SSH, containers, and remote agent services cannot reach the desktop Discord socket automatically. Run the daemon on the desktop and arrange an explicit local socket forwarding mechanism before using remote adapters. That forwarding is outside this first version.

## Development

From a source checkout, install dependencies and build:

```sh
npm install
npm run build
node dist/cli.js start
```

When running from this checkout without a global installation, replace `adp` in the examples above with `node dist/cli.js`. Rebuild after source changes, and regenerate adapter configuration if you move the checkout.

Run the checks:

```sh
npm test
npm run check
npm pack --dry-run
```

Tests cover multi-session arbitration, stale events and leases, protocol validation/privacy, CLI hooks through the real service socket, adapter lifecycle contracts, and a fake Discord server (fragmentation, PING/PONG, acknowledgements, coalescing, reconnection and clearing). Contract tests do not replace live validation inside each agent version.

Run integration tests in an environment that permits local socket listening and connections. The 27 tests pass on Node 26.8.2 on macOS, including background startup and graceful shutdown through the CLI. Live Discord returned the requested custom summary title and acknowledged clearing the activity. A repeatable live check is available (it briefly changes your activity and then clears it):

```sh
node scripts/smoke-discord.mjs
```

```text
src/
  protocol.ts       Versioned, allowlisted event protocol
  store.ts          Selection, pinning, expiry and ordering
  client.ts         Local IPC client and extension heartbeat reporter
  daemon.ts         Shared service
  discord.ts        Discord IPC framing and connection state
  cli.ts            Foreground service, status, config and hooks
  adapters/         Codex/Claude hooks, OpenCode/Harness plugins, Pi extension
plugins/            Distributable Codex and Claude Code plugin wrappers
```

Future adapters should emit protocol-v1 state events through `emit` or `Reporter`; they should not own a Discord connection.

Official API references reviewed on 2026-09-15:

- [Codex hooks](https://learn.chatgpt.com/docs/hooks)
- [Claude Code hooks](https://code.claude.com/docs/en/hooks) and [plugins](https://code.claude.com/docs/en/plugins-reference)
- [OpenCode plugins](https://opencode.ai/docs/plugins/)
- [Pi extensions](https://pi.dev/docs/latest/extensions)
- [Discord IPC RPC](https://docs.discord.com/developers/topics/rpc)
