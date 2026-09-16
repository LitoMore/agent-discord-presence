import {loadSettings, saveSettings, validateSettings, mergeSettings, type Configuration} from './settings.js';
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

export async function applyPreset(name: string, agent?: Agent): Promise<Configuration> {
  const config = loadSettings(); const preset = getPreset(name);
  if (agent) return saveSettings({...config, agents: {...config.agents, [agent]: mergeSettings(config.agents?.[agent] ?? {}, preset)}});
  return saveSettings(mergePreset(config, preset));
}
