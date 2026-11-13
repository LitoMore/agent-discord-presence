import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {request, socketPath} from './client.js';
import {startBackground} from './background.js';
import {agents, labels, type Agent} from './protocol.js';
import {loadSettings, saveSettings, resolveSettings, mergeSettings, settingsPath, type Configuration, type SettingsLayer} from './settings.js';
import {hookConfig} from './adapters/hooks.js';
import type {DesktopRequest, DesktopResponse, DesktopSnapshot, IntegrationInstructions, ServiceStatus, SettingsScope} from './desktop-protocol.js';

const cli = fileURLToPath(new URL('./cli.js', import.meta.url));
const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
function scopeAgent(scope: SettingsScope): Agent | undefined {
  if (scope === 'global') return;
  if (!agents.includes(scope)) throw new Error('Unknown settings scope');
  return scope;
}
export async function desktopSnapshot(): Promise<DesktopSnapshot> {
  let status: ServiceStatus | null = null;
  let serviceError: string | null = null;
  try { status = await request({type: 'status'}, undefined, 1500) as ServiceStatus; }
  catch (error) {
    if (!['ENOENT', 'ECONNREFUSED'].includes((error as NodeJS.ErrnoException).code ?? '')) serviceError = (error as Error).message;
  }
  let configuration: Configuration = {};
  let configurationError: string | null = null;
  try { configuration = loadSettings(); } catch (error) { configurationError = (error as Error).message; }
  return {status, serviceError, configurationError, configuration, effective: resolveSettings(configuration),
    agentSettings: Object.fromEntries(agents.map(agent => [agent, resolveSettings(configuration, agent)])) as DesktopSnapshot['agentSettings'],
    configPath: settingsPath(), socketPath: socketPath(), version: '0.0.3'};
}
function adapterInstructions(agent: Agent): Omit<IntegrationInstructions, 'prompt'> {
  if (!agents.includes(agent)) throw new Error('Unknown agent');
  if (agent === 'codex' || agent === 'claude-code') {
    if (process.platform === 'win32') throw new Error('On Windows, install the CLI on PATH and use the bundled agent plugin hooks. See USAGE.md for setup.');
    const command = `${quote(process.execPath)} ${quote(cli)}`;
    return {agent, path: join(homedir(), agent === 'codex' ? '.codex/hooks.json' : '.claude/settings.json'),
      content: JSON.stringify(hookConfig(agent, command), null, 2),
      instructions: agent === 'codex' ? 'Merge these hooks into your configuration, preserving existing hooks. Review and trust them in Codex /hooks, then start a new session.' : 'Merge these hooks into your configuration, preserving existing settings, then restart Claude Code.'};
  }
  if (agent === 'opencode' || agent === 'pi') {
    const source = new URL(`./adapters/${agent}.js`, import.meta.url).href;
    return {agent, path: agent === 'pi' ? join(homedir(), '.pi/agent/extensions/agent-presence.ts') : join(homedir(), '.config/opencode/plugins/agent-presence.ts'),
      content: agent === 'pi' ? `export { default } from ${JSON.stringify(source)};` : `export { AgentPresence } from ${JSON.stringify(source)};`,
      instructions: 'Save this content to the plugin file, then reload extensions or restart your agent.'};
  }
  const root = fileURLToPath(new URL('../', import.meta.url));
  return {agent, path: '', content: `dsh plugin --profile web add ${quote(root)}`,
    instructions: 'Run this command in your terminal, replacing web with your Harness profile, then restart Harness.'};
}
export function integrationInstructions(agent: Agent): IntegrationInstructions {
  const setup = adapterInstructions(agent);
  const root = fileURLToPath(new URL('../', import.meta.url));
  const prompt = [
    `Set up Agent Discord Presence for ${labels[agent]} on this computer.`,
    '',
    'Use the existing local installation that ships with the Presence desktop app:',
    `- Package directory: ${JSON.stringify(root)}`,
    `- Node.js executable: ${JSON.stringify(process.execPath)}`,
    `- CLI entry point: ${JSON.stringify(cli)}`,
    `- README: ${JSON.stringify(join(root, 'README.md'))}`,
    `- Setup guide: ${JSON.stringify(join(root, 'USAGE.md'))}`,
    `- Presence configuration: ${JSON.stringify(settingsPath())}`,
    `- Service socket: ${JSON.stringify(socketPath())}`,
    '',
    'Read the local README and setup guide, and check Node.js 22+ and the Discord desktop app. Reuse this installation rather than downloading another copy or rebuilding the desktop app.',
    '',
    `Configure only ${labels[agent]}. Inspect its existing configuration first, back up any file you change, preserve existing settings, hooks, plugins, and extensions, and avoid duplicate integrations.`,
    ...(setup.path ? [`Target configuration file: ${JSON.stringify(setup.path)}`] : []),
    setup.instructions,
    ...(agent === 'deepseek-harness' ? ['Determine which Harness profile I use and replace web in the command below with that profile.'] : []),
    '',
    `Use this ${agent === 'deepseek-harness' ? 'installation command' : 'configuration'} as the integration reference:`,
    '```' + (agent === 'codex' || agent === 'claude-code' ? 'json' : agent === 'deepseek-harness' ? 'sh' : 'ts'),
    setup.content,
    '```',
    '',
    'Use the Node.js executable and CLI entry point above to check service status. Reuse a running service, or start it in the background with the start --background arguments if it is stopped. Use the listed presence configuration and socket paths (ADP_CONFIG and AGENT_PRESENCE_SOCKET) for these commands, and ensure the agent integration reaches the same socket.',
    '',
    'Verify the service and Discord connection, then summarize the files changed and the checks performed. Tell me if I still need to open Discord, trust Codex hooks, reload extensions, restart the agent, or begin a new session before activity can appear.',
  ].join('\n');
  return {...setup, prompt};
}
/** Commands are serialized by the worker; read the latest file before every patch. */
export async function handleDesktopRequest(value: unknown): Promise<DesktopResponse> {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected desktop request');
    const message = value as DesktopRequest;
    if (message.action === 'integration') return {ok: true, integration: integrationInstructions(message.agent)};
    if (message.action === 'start') {
      try { await request({type: 'status'}, undefined, 1500); }
      catch (error) {
        if (!['ENOENT', 'ECONNREFUSED'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
        await startBackground(cli, process.env.ADP_DESKTOP_DRY_RUN === '1' ? ['--dry-run'] : []);
      }
    } else if (message.action === 'stop') {
      try { await request({type: 'stop'}, undefined, 10_000); }
      catch (error) { if (!['ENOENT', 'ECONNREFUSED'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
    } else if (message.action === 'pin') {
      if (message.key !== null && (typeof message.key !== 'string' || message.key.length > 512)) throw new Error('Invalid session key');
      await request({type: 'pin', key: message.key});
    } else if (message.action === 'save' || message.action === 'reset') {
      const agent = scopeAgent(message.scope);
      const config = loadSettings();
      const before = agent ? config.agents?.[agent] ?? {} : (() => {const {agents: _agents, ...global} = config; return global;})();
      let layer: SettingsLayer;
      if (message.action === 'save') {
        if (!message.patch || typeof message.patch !== 'object' || Array.isArray(message.patch) || Object.hasOwn(message.patch, 'agents')) throw new Error('Invalid settings patch');
        layer = mergeSettings(before, message.patch) as SettingsLayer;
        if (message.unset !== undefined) {
          if (!Array.isArray(message.unset) || message.unset.some(key => key !== 'presence.assets.large_image')) throw new Error('Invalid setting to unset');
          if (message.unset.includes('presence.assets.large_image') && layer.presence?.assets) delete layer.presence.assets.large_image;
        }
      } else {
        if (!Array.isArray(message.keys) || message.keys.some(key => !['enabled', 'customPrompt', 'maxLength', 'model', 'service', 'provider', 'baseUrl', 'apiKeyEnv', 'presence', 'presets'].includes(key))) throw new Error('Invalid reset keys');
        layer = {...before}; for (const key of message.keys) delete layer[key];
      }
      await saveSettings(agent ? {...config, agents: {...config.agents, [agent]: layer}} : {...layer, ...(config.agents ? {agents: config.agents} : {})});
    } else if (message.action !== 'snapshot') throw new Error('Unknown desktop action');
    return {ok: true, snapshot: await desktopSnapshot()};
  } catch (error) { return {ok: false, error: (error as Error).message}; }
}
