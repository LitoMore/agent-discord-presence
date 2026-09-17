import {loadSettings, saveSettings, validateSettings, mergeSettings, resolvePresets, type Configuration} from './settings.js';
import type {Agent} from './protocol.js';
import {PRESETS, type Preset} from './preset-data.js';
export {PRESETS, type Preset};

export function getPreset(name: string): Preset {
  if (!Object.hasOwn(PRESETS, name)) throw new Error(`Choose a preset: ${Object.keys(PRESETS).join(', ')}`);
  const preset = structuredClone(PRESETS[name]);
  validateSettings(preset);
  return preset;
}

/** Merge objects recursively; arrays and null replace existing values. */
export function mergePreset(settings: Configuration, preset: unknown): Configuration {
  validateSettings(preset);
  return validateSettings(mergeSettings(settings, preset));
}

/** Preview a composition without materializing default settings. */
export function getPresets(names: string[]): Preset {
  return resolvePresets(names);
}

/** Replace the selected presets while preserving explicit user settings. */
export async function applyPreset(names: string | string[], agent?: Agent): Promise<Configuration> {
  const presets = typeof names === 'string' ? [names] : names;
  getPresets(presets);
  const config = loadSettings();
  if (agent) return saveSettings({...config, agents: {...config.agents, [agent]: {...config.agents?.[agent], presets}}});
  return saveSettings({...config, presets});
}
