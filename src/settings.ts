import {readFileSync, existsSync} from 'node:fs';
import {mkdir, writeFile, rename} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {DEFAULT_PROMPT_CONFIG} from './prompts.js';
import {validatePresence, type PresenceOverrides} from './presentation.js';
import {agents, type Agent} from './protocol.js';
import {PRESETS} from './preset-data.js';
export interface Settings {enabled: boolean; customPrompt: string; maxLength: number; model: string;
  service: 'session' | 'openai-compatible'; provider: string; baseUrl: string; apiKeyEnv: string; presence: PresenceOverrides}
export interface SettingsLayer extends Partial<Settings> {presets?: string[]}
export interface Configuration extends SettingsLayer {agents?: Partial<Record<Agent, SettingsLayer>>}
export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({enabled: true, ...DEFAULT_PROMPT_CONFIG,
  service: 'session', model: '', provider: '', baseUrl: '', apiKeyEnv: 'OPENAI_API_KEY', presence: {}});
export function settingsPath(): string {
  return process.env.ADP_CONFIG ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'agent-discord-presence', 'config.json');
}
function validateBase(value: unknown): Settings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected settings object');
  const s = {...DEFAULT_SETTINGS, ...value};
  if (Object.keys(s).some(k => !Object.hasOwn(DEFAULT_SETTINGS, k))) throw new Error('Unknown setting');
  if (!['session', 'openai-compatible'].includes(s.service) || typeof s.provider !== 'string' || s.provider.length > 128 ||
      typeof s.baseUrl !== 'string' || s.baseUrl.length > 2048 || typeof s.apiKeyEnv !== 'string' || !/^(?:[A-Za-z_][A-Za-z0-9_]*)?$/.test(s.apiKeyEnv)) throw new Error('Invalid model service settings');
  if (s.baseUrl) {
    const url = new URL(s.baseUrl);
    if (url.username || url.password || url.search || url.hash ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('baseUrl must be HTTPS, or local HTTP, without credentials or query parameters');
  }
  if (typeof s.enabled !== 'boolean' || typeof s.customPrompt !== 'string' || s.customPrompt.length > 4000 ||
      typeof s.model !== 'string' || s.model.length > 128 || !Number.isInteger(s.maxLength) || s.maxLength < 20 || s.maxLength > 120) throw new Error('Invalid summary settings');
  s.presence = validatePresence(s.presence);
  return s;
}
/** Objects inherit recursively; arrays and null explicitly replace inherited values. */
export function mergeSettings(base: unknown, patch: unknown): unknown {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return structuredClone(patch);
  const result: Record<string, unknown> = base && typeof base === 'object' && !Array.isArray(base) ? structuredClone(base) as Record<string, unknown> : {};
  for (const [key, value] of Object.entries(patch)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Invalid setting key');
    result[key] = mergeSettings(result[key], value);
  }
  return result;
}
/** Resolve only explicitly selected preset fields, in order. */
export function resolvePresets(names: unknown): Partial<Settings> {
  if (!Array.isArray(names) || names.some(name => typeof name !== 'string' || !Object.hasOwn(PRESETS, name))) {
    throw new Error(`Expected a presets array containing: ${Object.keys(PRESETS).join(', ')}`);
  }
  let result: Partial<Settings> = {};
  for (const name of names) {
    const preset = PRESETS[name];
    validateBase(preset);
    result = mergeSettings(result, preset) as Partial<Settings>;
  }
  validateBase(result);
  return result;
}
function validateLayer(value: unknown): SettingsLayer {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected settings object');
  const {presets, ...explicit} = value as Record<string, unknown>;
  validateBase(explicit);
  if (presets !== undefined) resolvePresets(presets);
  return structuredClone(value) as SettingsLayer;
}
export function validateSettings(value: unknown): Configuration {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected settings object');
  const {agents: overrides, ...base} = value as Record<string, unknown>;
  const settings: Configuration = validateLayer(base);
  if (overrides !== undefined) {
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) throw new Error('Invalid agent settings');
    settings.agents = {};
    for (const [agent, patch] of Object.entries(overrides)) {
      if (!agents.includes(agent as Agent)) throw new Error('Invalid agent settings');
      settings.agents[agent as Agent] = validateLayer(patch);
    }
  }
  resolveSettings(settings);
  for (const agent of agents) resolveSettings(settings, agent);
  return settings;
}
export function resolveSettings(config: Configuration, agent?: Agent): Settings {
  const {agents: overrides, presets = [], ...base} = config;
  const {presets: agentPresets = [], ...explicit} = agent ? overrides?.[agent] ?? {} : {};
  const defaults = agent ? {presence: {assets: PRESETS[agent]?.presence?.assets ?? {}}} : {};
  let result: unknown = defaults;
  for (const layer of [resolvePresets(presets), resolvePresets(agentPresets), base, explicit]) {
    result = mergeSettings(result, layer);
  }
  return validateBase(result);
}
export function loadSettings(): Configuration {
  const path = settingsPath();
  if (!existsSync(path)) return {};
  const data = readFileSync(path);
  if (data.length > 131_072) throw new Error('Settings file too large');
  return validateSettings(JSON.parse(data.toString()));
}
export async function saveSetting(key: string, value: unknown, unset = false, agent?: Agent): Promise<Configuration> {
  const draft = structuredClone(loadSettings()) as unknown as Record<string, unknown>;
  const keys = key.split('.');
  if (keys.some(k => !k || ['__proto__', 'constructor', 'prototype'].includes(k)) || (keys.length > 1 && keys[0] !== 'presence')) throw new Error('Invalid setting path');
  let target = draft;
  if (agent) {
    if (!agents.includes(agent)) throw new Error('Unknown agent');
    const overrides = (draft.agents ??= {}) as Record<string, Record<string, unknown>>;
    target = overrides[agent] ??= {};
  }
  for (const part of keys.slice(0, -1)) {
    if (target[part] === undefined || target[part] === null) target[part] = {};
    if (typeof target[part] !== 'object' || Array.isArray(target[part])) throw new Error('Invalid setting path');
    target = target[part] as Record<string, unknown>;
  }
  if (unset) delete target[keys.at(-1)!]; else target[keys.at(-1)!] = value;
  return saveSettings(draft);
}
export async function saveSettings(value: unknown): Promise<Configuration> {
  const settings = validateSettings(value);
  const path = settingsPath(); await mkdir(dirname(path), {recursive: true, mode: 0o700});
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(settings, null, 2) + '\n', {mode: 0o600});
  await rename(temp, path);
  return settings;
}
