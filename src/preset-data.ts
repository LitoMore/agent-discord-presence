import {readFileSync} from 'node:fs';
import type {Settings} from './settings.js';

export type Preset = Partial<Settings>;
export const PRESETS: Readonly<Record<string, Preset>> = JSON.parse(
  readFileSync(new URL('../presets.json', import.meta.url), 'utf8'),
);
