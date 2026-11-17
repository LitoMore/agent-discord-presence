import type {Agent, State} from './protocol.js';
import type {Activity} from './presentation.js';
import type {Configuration, Settings, SettingsLayer} from './settings.js';
import type {Summary} from './summary.js';
import type {UninstallPlan, UninstallResult} from './uninstall.js';
import type {SetupOptions, SetupPlan, SetupResult} from './setup.js';
import type {AgentDescriptor} from './agent-plugins.js';
import type {PluginInstallState} from './plugin-install.js';

export interface DiscordProfile {id: string; username: string; globalName?: string; avatar?: string}
export interface DesktopSession {
  key: string; agent?: Agent; label?: string; state: State; model?: string; provider?: string;
  startedAt: number; updatedAt: number; lastSeen: number; summary?: Summary;
}
export interface ServiceStatus {
  ok: true; discord: string; activityAcknowledged: boolean | null; pinned: string | null;
  pid: number; activity: Activity | null; selected: string | null; settingsError: string | null;
  sessions: DesktopSession[]; profile?: DiscordProfile | null;
}
export interface DesktopSnapshot {
  agents: AgentDescriptor[]; plugins: AgentDescriptor[]; pluginError: string | null;
  pluginInstall: PluginInstallState | null;
  status: ServiceStatus | null; serviceError: string | null; configurationError: string | null;
  configuration: Configuration; effective: Settings; agentSettings: Record<Agent, Settings>;
  configPath: string; socketPath: string; version: string;
}
export type SettingsScope = 'global' | Agent;
export type DesktopRequest =
  | {action: 'plugin-install'; path: string}
  | {action: 'plugin-install-start'; source: string}
  | {action: 'plugin-install-cancel'; id: string}
  | {action: 'plugin-enable' | 'plugin-disable' | 'plugin-remove'; agent: string}
  | {action: 'snapshot' | 'start' | 'stop'}
  | {action: 'pin'; key: string | null}
  | {action: 'save'; scope: SettingsScope; patch: SettingsLayer; unset?: ('presence.assets.large_image')[]}
  | {action: 'reset'; scope: SettingsScope; keys: (keyof SettingsLayer)[]}
  | ({action: 'integration'; agent: Agent; language?: 'en' | 'zh-CN'} & SetupOptions)
  | ({action: 'setup'; agent: Agent; revision: string} & SetupOptions)
  | {action: 'uninstall-preview'; agent: Agent; path?: string; events?: string[]}
  | {action: 'uninstall'; agent: Agent; path?: string; revision: string; events?: string[]};
export interface IntegrationInstructions {agent: Agent; path: string; content: string; instructions: string; prompt: string; summaryCommand?: string}
export type DesktopResponse = {ok: true; snapshot?: DesktopSnapshot; integration?: IntegrationInstructions; setupPlan?: SetupPlan; setupResult?: SetupResult; uninstallPlan?: UninstallPlan; uninstallResult?: UninstallResult} | {ok: false; error: string};
