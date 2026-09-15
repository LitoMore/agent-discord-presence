# Agent Discord Presence

Discord Rich Presence for Codex, Claude Code, OpenCode, and Pi, powered by one local service that keeps your active work visible in Discord.

### Features

- Generates a summary title, subtitle, activity state, and elapsed session time for your active agent work.
- Selects the active session across supported agents, reconnects to Discord, and clears stale sessions automatically.
- Uses the current agent model by default for summaries, with optional custom model, service, language, and prompt styling.
- Sends up to 4,000 characters of the completed assistant reply to the summarization model and includes model usage metadata.
- Allows automatic summaries to be disabled while keeping lifecycle updates enabled.
- DeepSeek Harness support is planned; its adapter is not implemented yet.

## Quick start

Requires Node.js 22+ and the Discord desktop app.

```sh
npm install --global agent-discord-presence
adp start
```

To release the terminal after startup, use `adp start -b`. Then connect your agent:

- [Codex](USAGE.md#codex)
- [Claude Code](USAGE.md#claude-code)
- [OpenCode](USAGE.md#opencode)
- [Pi](USAGE.md#pi)

A default Discord Application ID is included; no bot token is needed. Automatic startup is not configured.

Stop the service with `adp stop`, or press Ctrl+C in its terminal. This clears its Discord activity.

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
