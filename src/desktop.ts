import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {request, socketPath} from './client.js';
import {startBackground} from './background.js';
import {agents, labels, type Agent} from './protocol.js';
import {loadSettings, saveSettings, resolveSettings, mergeSettings, settingsPath, type Configuration, type SettingsLayer} from './settings.js';
import {hookConfig} from './adapters/hooks.js';
import type {DesktopRequest, DesktopResponse, DesktopSnapshot, IntegrationInstructions, ServiceStatus, SettingsScope} from './desktop-protocol.js';
import {integrationPath, planUninstall, uninstallIntegration} from './uninstall.js';

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
function adapterInstructions(agent: Agent, chinese: boolean): Omit<IntegrationInstructions, 'prompt'> {
  if (!agents.includes(agent)) throw new Error('Unknown agent');
  if (agent === 'codex' || agent === 'claude-code') {
    if (process.platform === 'win32') throw new Error('On Windows, install the CLI on PATH and use the bundled agent plugin hooks. See USAGE.md for setup.');
    const command = `${quote(process.execPath)} ${quote(cli)}`;
    return {agent, path: integrationPath(agent),
      content: JSON.stringify(hookConfig(agent, command), null, 2),
      instructions: agent === 'codex'
        ? chinese ? '将这些钩子合并到配置中，保留现有钩子。在 Codex /hooks 中检查并信任它们，然后开始新会话。' : 'Merge these hooks into your configuration, preserving existing hooks. Review and trust them in Codex /hooks, then start a new session.'
        : chinese ? '将这些钩子合并到配置中，保留现有设置，然后重启 Claude Code。' : 'Merge these hooks into your configuration, preserving existing settings, then restart Claude Code.'};
  }
  if (agent === 'opencode' || agent === 'pi') {
    const source = new URL(`./adapters/${agent}.js`, import.meta.url).href;
    return {agent, path: integrationPath(agent),
      content: agent === 'pi' ? `export { default } from ${JSON.stringify(source)};` : `export { AgentPresence } from ${JSON.stringify(source)};`,
      instructions: chinese ? '将此内容保存到插件文件，然后重新加载扩展或重启智能体。' : 'Save this content to the plugin file, then reload extensions or restart your agent.'};
  }
  const root = fileURLToPath(new URL('../', import.meta.url));
  return {agent, path: '', content: `dsh plugin --profile web add ${quote(root)}`,
    instructions: chinese ? '在终端中运行此命令，将 web 替换为你的 Harness 配置名称，然后重启 Harness。' : 'Run this command in your terminal, replacing web with your Harness profile, then restart Harness.'};
}
export function integrationInstructions(agent: Agent, language: 'en' | 'zh-CN' = 'en'): IntegrationInstructions {
  const chinese = language === 'zh-CN';
  const setup = adapterInstructions(agent, chinese);
  const root = fileURLToPath(new URL('../', import.meta.url));
  const prompt = (chinese ? [
    `请在这台电脑上为 ${labels[agent]} 配置 Agent Discord Presence。`,
    '',
    '请使用 Presence 桌面应用附带的现有本地安装：',
    `- 软件包目录：${JSON.stringify(root)}`,
    `- Node.js 可执行文件：${JSON.stringify(process.execPath)}`,
    `- CLI 入口：${JSON.stringify(cli)}`,
    `- README：${JSON.stringify(join(root, 'README.md'))}`,
    `- 配置指南：${JSON.stringify(join(root, 'USAGE.md'))}`,
    `- Presence 配置文件：${JSON.stringify(settingsPath())}`,
    `- 服务套接字：${JSON.stringify(socketPath())}`,
    '',
    '阅读本地 README 和配置指南，检查 Node.js 22+ 和 Discord 桌面客户端。复用这份安装，无需另行下载或重新构建桌面应用。',
    '',
    `只配置 ${labels[agent]}。先检查其现有配置，备份所有需要修改的文件，保留现有设置、钩子、插件和扩展，并避免重复集成。`,
    ...(setup.path ? [`目标配置文件：${JSON.stringify(setup.path)}`] : []),
    setup.instructions,
    ...(agent === 'deepseek-harness' ? ['确定我使用的 Harness 配置名称，并将下方命令中的 web 替换为该名称。'] : []),
    '',
    `以下${agent === 'deepseek-harness' ? '安装命令' : '配置'}可作为集成参考：`,
    '```' + (agent === 'codex' || agent === 'claude-code' ? 'json' : agent === 'deepseek-harness' ? 'sh' : 'ts'),
    setup.content,
    '```',
    '',
    '使用上面的 Node.js 可执行文件和 CLI 入口检查服务状态。复用正在运行的服务；如果服务已停止，则使用 start --background 参数在后台启动。运行这些命令时，通过 ADP_CONFIG 和 AGENT_PRESENCE_SOCKET 指定上面列出的 Presence 配置文件和套接字路径，并确保智能体集成连接到同一个套接字。',
    '',
    '验证服务和 Discord 连接，然后用中文总结修改的文件和执行的检查。如果还需要打开 Discord、信任 Codex 钩子、重新加载扩展、重启智能体或开始新会话才能显示活动，请告诉我。',
  ] : [
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
  ]).join('\n');
  return {...setup, prompt};
}
/** Commands are serialized by the worker; read the latest file before every patch. */
export async function handleDesktopRequest(value: unknown): Promise<DesktopResponse> {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected desktop request');
    const message = value as DesktopRequest;
    if (message.action === 'integration') return {ok: true, integration: integrationInstructions(message.agent, message.language)};
    if (message.action === 'uninstall-preview') return {ok: true, uninstallPlan: await planUninstall(message.agent, message.path)};
    if (message.action === 'uninstall') {
      if (typeof message.revision !== 'string' || !/^[a-f0-9]{64}$/.test(message.revision)) throw new Error('Preview the integration removal before confirming it.');
      return {ok: true, uninstallResult: await uninstallIntegration(message.agent, message.path, message.revision)};
    }
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
