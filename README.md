# Agent Discord Presence

Discord Rich Presence for Codex, Claude Code, OpenCode, Pi, and DeepSeek Harness, powered by one local service that keeps your active work visible in Discord.

> [!NOTE]\
> This project is in early development, so expect frequent changes.

### Features

- Generates a summary title, subtitle, activity state, and elapsed session time for your active agent work.
- Selects the active session across supported agents, reconnects to Discord, and clears stale sessions automatically.
- Uses the current agent model by default for summaries, with optional custom model, service, language, and prompt styling.
- Sends up to 4,000 characters of the completed assistant reply to the summarization model and includes model usage metadata.
- Allows automatic summaries to be disabled while keeping lifecycle updates enabled.
- Runs multiple agents together with [independent model, prompt, and display settings](USAGE.md#independent-configuration-for-each-agent).

## Quick start

The easiest way to get started is to let your agent handle the setup. Paste this repository link into your agent, or copy the prompt below:

```text
Install and configure agent-discord-presence for the agent I'm using:
https://github.com/LitoMore/agent-discord-presence

Read the README and USAGE.md, check the prerequisites, install the package,
and set up the hooks or plugin for my agent while preserving my existing
configuration. Start the service in the background, check its status, and
let me know if I need to restart my agent or take any other steps.
```

You'll need Node.js 22+ and the Discord desktop app. Open Discord and sign in before checking your presence. A default Discord Application ID is included; no bot token is needed.

Prefer to set it up yourself? Install the package and start the service in the background:

```sh
npm install --global agent-discord-presence
adp start -b
```

Then follow the setup instructions for your agent:

- [Codex](USAGE.md#codex)
- [Claude Code](USAGE.md#claude-code)
- [OpenCode](USAGE.md#opencode)
- [Pi](USAGE.md#pi)
- [DeepSeek Harness](USAGE.md#deepseek-harness)

Once connected, give your agent a task and check Discord for its activity. Run `adp status` to check the service and Discord connection.

Stop the service with `adp stop`; this clears its Discord activity. To run in the foreground instead, use `adp start` and stop it with Ctrl+C. Automatic startup is not configured, so run `adp start -b` again after restarting your computer.

## Documentation

See the [usage guide](USAGE.md) for installation, configuration, and operation:

- [Images and display settings](USAGE.md#images-and-display-settings)
- [Prompts and language](USAGE.md#default-presence-prompts)
- [Model and service selection](USAGE.md#automatic-generation-and-model-selection)
- [Presence layout and manual summaries](USAGE.md#summary-title-layout)
- [Session selection and lifecycle](USAGE.md#session-selection-and-lifecycle)
- [Configuration and platform notes](USAGE.md#configuration-and-platform-notes)

## License

MIT
