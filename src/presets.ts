import {readFileSync} from 'node:fs';
import {loadSettings, saveSettings, validateSettings, type Settings} from './settings.js';

export type Preset = Partial<Settings>;
export const PRESETS: Readonly<Record<string, Preset>> = JSON.parse(
  readFileSync(new URL('../presets.json', import.meta.url), 'utf8'),
);

export function getPreset(name: string): Preset {
  if (!Object.hasOwn(PRESETS, name)) throw new Error(`Choose a preset: ${Object.keys(PRESETS).join(', ')}`);
  const preset = structuredClone(PRESETS[name]);
  validateSettings(preset);
  return preset;
}

/** Merge objects recursively; arrays and null replace existing values. */
export function mergePreset(settings: Settings, preset: unknown): Settings {
  validateSettings(preset);
  function merge(base: unknown, patch: unknown): unknown {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return structuredClone(patch);
    const result: Record<string, unknown> = base && typeof base === 'object' && !Array.isArray(base)
      ? structuredClone(base) as Record<string, unknown> : {};
    for (const [key, value] of Object.entries(patch)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Invalid preset key');
      result[key] = merge(result[key], value);
    }
    return result;
  }
  return validateSettings(merge(settings, preset));
}

export async function applyPreset(name: string): Promise<Settings> {
  return saveSettings(mergePreset(loadSettings(), getPreset(name)));
}
