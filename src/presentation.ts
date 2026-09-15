import {labels} from './protocol.js';
import type {Session} from './store.js';

export interface Assets {large_image?: string; large_text?: string; large_url?: string; small_image?: string; small_text?: string; small_url?: string}
export interface Activity {
  type: number; name: string; details?: string; state?: string;
  details_url?: string; state_url?: string; status_display_type?: number;
  timestamps?: {start?: number; end?: number}; assets?: Assets;
  buttons?: {label: string; url: string}[]; party?: {id?: string; size?: [number, number]};
}
export interface PresenceOverrides {
  type?: number; name?: string; details?: string | null; state?: string | null;
  details_url?: string; state_url?: string; status_display_type?: number;
  timestamps?: {start?: number | 'session'; end?: number} | null;
  assets?: Assets | null; buttons?: {label: string; url: string}[];
  party?: {id?: string; size?: [number, number]} | null;
}
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) throw new Error('Invalid presence object or unknown field');
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 128): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || Array.from(value).length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`Presence text must contain 1–${max} characters without control characters`);
}
function url(value: unknown) {
  text(value, 2048);
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.username || u.password) throw new Error('Presence URLs must use HTTPS without credentials');
}
export function validatePresence(value: unknown): PresenceOverrides {
  const p = object(value, ['type', 'name', 'details', 'state', 'details_url', 'state_url', 'status_display_type', 'timestamps', 'assets', 'buttons', 'party']);
  if (p.type !== undefined && ![0, 2, 3, 5].includes(p.type as number)) throw new Error('Presence type must be 0 (Playing), 2 (Listening), 3 (Watching), or 5 (Competing)');
  if (p.status_display_type !== undefined && ![0, 1, 2].includes(p.status_display_type as number)) throw new Error('status_display_type must be 0, 1, or 2');
  for (const k of ['name', 'details', 'state']) if (p[k] !== undefined && !(k !== 'name' && p[k] === null)) text(p[k]);
  for (const k of ['details_url', 'state_url']) if (p[k] !== undefined) url(p[k]);
  if (p.assets !== undefined && p.assets !== null) {
    const a = object(p.assets, ['large_image', 'large_text', 'large_url', 'small_image', 'small_text', 'small_url']);
    for (const [key, v] of Object.entries(a)) {
      if (key.endsWith('_url')) url(v);
      else if (key.endsWith('_image')) {
        text(v, 2048);
        if (v.startsWith('https://')) url(v);
        else if (!/^[a-zA-Z0-9_-]{1,256}$/.test(v)) throw new Error('Images must be HTTPS URLs or Discord application asset keys');
      } else text(v);
    }
  }
  if (p.timestamps !== undefined && p.timestamps !== null) {
    const times = object(p.timestamps, ['start', 'end']);
    for (const [key, v] of Object.entries(times)) if (!(key === 'start' && v === 'session') && !(typeof v === 'number' && Number.isSafeInteger(v) && v > 0)) throw new Error('Timestamps must be positive Unix seconds; start also accepts session');
    if (typeof times.start === 'number' && typeof times.end === 'number' && times.end <= times.start) throw new Error('End timestamp must follow start');
  }
  if (p.buttons !== undefined) {
    if (!Array.isArray(p.buttons) || p.buttons.length > 2) throw new Error('At most two presence buttons are allowed');
    for (const item of p.buttons) { const b = object(item, ['label', 'url']); text(b.label, 32); url(b.url); }
  }
  if (p.party !== undefined && p.party !== null) {
    const party = object(p.party, ['id', 'size']);
    if (party.id !== undefined) text(party.id);
    if (party.size !== undefined && (!Array.isArray(party.size) || party.size.length !== 2 || party.size.some(n => !Number.isSafeInteger(n) || n < 1) || party.size[0] > party.size[1])) throw new Error('Party size must be [current, maximum] with positive integers');
  }
  return structuredClone(p) as PresenceOverrides;
}
export function activityFor(session?: Session, p: PresenceOverrides = {}): Activity | null {
  if (!session) return null;
  const phases = {idle: 'Ready for a prompt', working: 'Working', waiting: 'Waiting for input', error: 'Needs attention', closed: 'Closed'};
  const values: Record<string, string> = {agent: labels[session.agent], phase: phases[session.state], state: session.state,
    topic: session.summary?.topic ?? `Coding with ${labels[session.agent]}`, subtitle: session.summary?.subtitle || `${labels[session.agent]} session`};
  const render = (s: string, max = 128) => Array.from(s.replace(/\{(agent|phase|state|topic|subtitle)\}/g, (_, k) => values[k])).slice(0, max).join('');
  const result: Activity = {type: p.type ?? 0, name: render(p.name ?? '{topic}')};
  for (const k of ['details', 'state'] as const) if (p[k] !== null) result[k] = render(p[k] ?? (k === 'details' ? '{phase}' : '{subtitle}'));
  for (const k of ['details_url', 'state_url', 'status_display_type'] as const) if (p[k] !== undefined) Object.assign(result, {[k]: p[k]});
  if (p.timestamps !== null) {
    const times = p.timestamps ?? {start: 'session'};
    result.timestamps = {...times, ...(times.start === 'session' ? {start: Math.floor(session.startedAt / 1000)} : {})} as Activity['timestamps'];
  }
  if (p.assets) {
    result.assets = {...p.assets};
    for (const k of ['large_text', 'small_text'] as const) if (p.assets[k]) result.assets[k] = render(p.assets[k]);
  }
  if (p.buttons?.length) result.buttons = p.buttons.map(b => ({...b, label: render(b.label, 32)}));
  if (p.party) result.party = structuredClone(p.party);
  return result;
}
