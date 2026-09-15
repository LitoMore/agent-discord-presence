import {readFileSync, existsSync} from 'node:fs';
import {mkdir, writeFile, rename} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {DEFAULT_PROMPT_CONFIG} from './prompts.js';
import {validatePresence, type PresenceOverrides} from './presentation.js';
export interface Settings {enabled: boolean; customPrompt: string; maxLength: number; model: string;
  service: 'session' | 'openai-compatible'; provider: string; baseUrl: string; apiKeyEnv: string; presence: PresenceOverrides}
export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({enabled: true, ...DEFAULT_PROMPT_CONFIG,
  service: 'session', model: '', provider: '', baseUrl: '', apiKeyEnv: 'OPENAI_API_KEY', presence: {}});
export function settingsPath(): string {
  return process.env.ADP_CONFIG ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'agent-discord-presence', 'config.json');
}
export function validateSettings(value: unknown): Settings {
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
export function loadSettings(): Settings {
  const path = settingsPath();
  if (!existsSync(path)) return {...DEFAULT_SETTINGS};
  const data = readFileSync(path);
  if (data.length > 16_384) throw new Error('Settings file too large');
  return validateSettings(JSON.parse(data.toString()));
}
export async function saveSetting(key: string, value: unknown, unset = false): Promise<Settings> {
  const draft = structuredClone(loadSettings()) as unknown as Record<string, unknown>;
  const keys = key.split('.');
  if (keys.some(k => !k || ['__proto__', 'constructor', 'prototype'].includes(k)) || (keys.length > 1 && keys[0] !== 'presence')) throw new Error('Invalid setting path');
  let target = draft;
  for (const part of keys.slice(0, -1)) {
    if (target[part] === undefined || target[part] === null) target[part] = {};
    if (typeof target[part] !== 'object' || Array.isArray(target[part])) throw new Error('Invalid setting path');
    target = target[part] as Record<string, unknown>;
  }
  if (unset) delete target[keys.at(-1)!]; else target[keys.at(-1)!] = value;
  return saveSettings(draft);
}
export async function saveSettings(value: unknown): Promise<Settings> {
  const settings = validateSettings(value);
  const path = settingsPath(); await mkdir(dirname(path), {recursive: true, mode: 0o700});
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(settings, null, 2) + '\n', {mode: 0o600});
  await rename(temp, path);
  return settings;
}
