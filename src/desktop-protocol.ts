import type {Agent, State} from './protocol.js';
import type {Activity} from './presentation.js';
import type {Configuration, Settings, SettingsLayer} from './settings.js';
import type {Summary} from './summary.js';

export interface DiscordProfile {id: string; username: string; globalName?: string; avatar?: string}
export interface DesktopSession {
  key: string; agent?: Agent; state: State; model?: string; provider?: string;
  startedAt: number; updatedAt: number; lastSeen: number; summary?: Summary;
}
export interface ServiceStatus {
  ok: true; discord: string; activityAcknowledged: boolean | null; pinned: string | null;
  pid: number; activity: Activity | null; selected: string | null; settingsError: string | null;
  sessions: DesktopSession[]; profile?: DiscordProfile | null;
}
export interface DesktopSnapshot {
  status: ServiceStatus | null; serviceError: string | null; configurationError: string | null;
  configuration: Configuration; effective: Settings; agentSettings: Record<Agent, Settings>;
  configPath: string; socketPath: string; version: string;
}
export type SettingsScope = 'global' | Agent;
export type DesktopRequest =
  | {action: 'snapshot' | 'start' | 'stop'}
  | {action: 'pin'; key: string | null}
  | {action: 'save'; scope: SettingsScope; patch: SettingsLayer; unset?: ('presence.assets.large_image')[]}
  | {action: 'reset'; scope: SettingsScope; keys: (keyof SettingsLayer)[]}
  | {action: 'integration'; agent: Agent};
export interface IntegrationInstructions {agent: Agent; path: string; content: string; instructions: string; prompt: string}
export type DesktopResponse = {ok: true; snapshot?: DesktopSnapshot; integration?: IntegrationInstructions} | {ok: false; error: string};
