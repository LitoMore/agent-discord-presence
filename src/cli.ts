#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {startDaemon} from './daemon.js';
import {request, summaryTarget, publishSummary} from './client.js';
import {hookConfig, runHook} from './adapters/hooks.js';
const help = `agent-discord-presence

  start                     Run the shared Discord presence service
  start --background, -b    Start in the background and return to the terminal
  stop                      Stop the service and clear Discord activity
  start --dry-run            Print activities without connecting to Discord
  status                    Show connection and sessions as JSON
  pin AGENT:SESSION_ID      Select one session
  unpin                     Resume automatic selection
  config codex|claude-code  Print hook JSON using this checkout's CLI
  config opencode|pi        Print a local plugin/extension entry file
  hook codex|claude-code    Receive a lifecycle hook on stdin
  prompt [PRESET]           Print the default prompt, preferences, and output schema
  preset list              List available configuration presets
  preset show NAME         Preview a preset without changing settings
  preset apply NAME        Merge a preset into saved settings
  summary KEY TOPIC [SUBTITLE]  Set public summary text for an existing session
  clear-summary KEY        Restore the session's default title
  config show              Show summary and presence settings
  config set KEY VALUE     Save summary, model, or presence settings
  config unset KEY         Restore a setting to its default

Options: --client-id ID, --socket PATH, --stale-minutes N (default 30, hooks only)
Environment: DISCORD_CLIENT_ID, AGENT_PRESENCE_SOCKET, DISCORD_IPC_PATH, ADP_CONFIG
`;
async function main() {
  const {values, positionals} = parseArgs({allowPositionals: true, options: {
    'client-id': {type: 'string'}, 'dry-run': {type: 'boolean'}, socket: {type: 'string'},
    'stale-minutes': {type: 'string'}, help: {type: 'boolean', short: 'h'},
    background: {type: 'boolean', short: 'b'},
  }});
  const [command, argument] = positionals;
  if (values.socket) process.env.AGENT_PRESENCE_SOCKET = values.socket;
  if (!command || values.help) { console.log(help); return; }
  if (values.background && command !== 'start') throw new Error('--background is only available for start');
  if (command === 'summary' || command === 'clear-summary') {
    if (!argument || (command === 'summary' && !positionals[2])) throw new Error('Use summary AGENT:SESSION_ID TOPIC [SUBTITLE]');
    const target = await summaryTarget(argument);
    await publishSummary(target, command === 'clear-summary' ? null : {topic: positionals[2], subtitle: positionals[3] ?? ''});
    return;
  }
  if (command === 'preset') {
    const {PRESETS, getPreset, applyPreset} = await import('./presets.js');
    if (argument === 'list') console.log(JSON.stringify(Object.keys(PRESETS), null, 2));
    else if ((argument === 'show' || argument === 'apply') && positionals[2]) {
      console.log(JSON.stringify(argument === 'show' ? getPreset(positionals[2]) : await applyPreset(positionals[2]), null, 2));
    } else throw new Error('Use preset list, preset show NAME, or preset apply NAME');
    return;
  }
  if (command === 'prompt') {
    const {buildPresencePrompt, DEFAULT_PROMPT_CONFIG} = await import('./prompts.js');
    const {getPreset} = await import('./presets.js');
    const preset = argument ?? 'default';
    const preferences = getPreset(preset);
    const config = {customPrompt: preferences.customPrompt ?? DEFAULT_PROMPT_CONFIG.customPrompt,
      maxLength: preferences.maxLength ?? DEFAULT_PROMPT_CONFIG.maxLength};
    const {systemPrompt, schema} = buildPresencePrompt({agent: 'codex', response: ''}, config);
    console.log(JSON.stringify({config, systemPrompt, schema}, null, 2));
    return;
  }
  if (command === 'hook') {
    if (argument === 'codex' || argument === 'claude-code') await runHook(argument);
    return;
  }
  if (command === 'config') {
    if (argument === 'show' || argument === 'set' || argument === 'unset') {
      const {loadSettings, saveSetting, settingsPath} = await import('./settings.js');
      if (argument === 'set' || argument === 'unset') {
        const [key, raw] = positionals.slice(2);
        if (!key || (argument === 'set' && raw === undefined)) throw new Error('Use config set KEY VALUE');
        let value: unknown = raw;
        if (argument === 'set') {
          if (['presence', 'presence.assets', 'presence.timestamps', 'presence.party', 'presence.buttons', 'presence.party.size'].includes(key)) value = JSON.parse(raw);
          else if (['presence.type', 'presence.status_display_type', 'presence.timestamps.end', 'maxLength'].includes(key) || (key === 'presence.timestamps.start' && raw !== 'session')) value = Number(raw);
          else if (['presence.details', 'presence.state'].includes(key) && raw === 'null') value = null;
          else if (key === 'enabled') value = raw === 'true' ? true : raw === 'false' ? false : raw;
        }
        await saveSetting(key, value, argument === 'unset');
      }
      console.log(JSON.stringify({path: settingsPath(), ...loadSettings()}, null, 2));
      return;
    }
    if (argument === 'codex' || argument === 'claude-code') {
      if (process.platform === 'win32') throw new Error('On Windows, install the CLI on PATH and use the bundled plugin hooks');
      const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
      const cli = `${quote(process.execPath)} ${quote(fileURLToPath(import.meta.url))}`;
      console.log(JSON.stringify(hookConfig(argument, cli), null, 2));
    } else if (argument === 'opencode' || argument === 'pi') {
      const path = new URL(`./adapters/${argument}.js`, import.meta.url).href;
      console.log(argument === 'pi' ? `export { default } from ${JSON.stringify(path)};` : `export { AgentPresence } from ${JSON.stringify(path)};`);
    } else throw new Error('Choose codex, claude-code, opencode, or pi');
    return;
  }
  if (command === 'start') {
    const minutes = Number(values['stale-minutes'] ?? 30);
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) throw new Error('--stale-minutes must be between 1 and 1440');
    if (values.background) {
      const {startBackground} = await import('./background.js');
      const args = ['--stale-minutes', String(minutes)];
      if (values['client-id']) args.push('--client-id', values['client-id']);
      if (values['dry-run']) args.push('--dry-run');
      const result = await startBackground(fileURLToPath(import.meta.url), args);
      console.log(`Presence service started in background (PID ${result.pid}).\nLog: ${result.log}`);
      return;
    }
    const daemon = await startDaemon({clientId: values['client-id'] ?? process.env.DISCORD_CLIENT_ID,
      dryRun: values['dry-run'], staleMs: minutes * 60_000});
    console.log(`Presence service listening at ${daemon.path}`);
    const close = () => { void daemon.close(); };
    process.once('SIGINT', close); process.once('SIGTERM', close);
    if (process.send) process.send({type: 'ready'});
    return;
  }
  if (command === 'stop') {
    try {
      await request({type: 'stop'}, undefined, 10_000);
      console.log('Presence service stopped.');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ECONNREFUSED') console.log('Presence service is not running.');
      else if ((error as Error).message === 'Unknown request type') throw new Error('The running service does not support stop; restart it with the updated version.');
      else throw error;
    }
  }
  else if (command === 'status') console.log(JSON.stringify(await request({type: 'status'}), null, 2));
  else if (command === 'pin' && argument) await request({type: 'pin', key: argument});
  else if (command === 'unpin') await request({type: 'pin', key: null});
  else throw new Error('Unknown command. Use --help.');
}
main().catch(error => {
  console.error((error as Error).message); process.exitCode = 1;
  if (process.send) process.send({type: 'startup-error', error: (error as Error).message});
});
