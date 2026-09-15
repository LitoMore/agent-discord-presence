import {readFileSync} from 'node:fs';
import {labels, type Agent} from './protocol.js';

export interface PromptConfig {customPrompt: string; maxLength: number}
export const DEFAULT_PROMPT_CONFIG: Readonly<PromptConfig> = Object.freeze(
  JSON.parse(readFileSync(new URL('../prompts/default.json', import.meta.url), 'utf8')),
);
export const PROMPT_PRESETS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.entries(JSON.parse(readFileSync(new URL('../presets.json', import.meta.url), 'utf8')) as Record<string, {customPrompt?: string}>).map(([name, preset]) => [name, preset.customPrompt ?? ''])),
);
export const DEFAULT_PRESENCE_PROMPT = readFileSync(new URL('../prompts/presence.md', import.meta.url), 'utf8').trim();
export const SOURCE_MAX_LENGTH = 4000;

/** Prepare a provider-neutral request; this does not call a model or publish activity. */
export function buildPresencePrompt(input: {agent: Agent; response: string}, config: Partial<PromptConfig> = {}) {
  const {customPrompt, maxLength} = {...DEFAULT_PROMPT_CONFIG, ...config};
  if (!Number.isInteger(maxLength) || maxLength < 20 || maxLength > 120) {
    throw new Error('Prompt maxLength must be an integer between 20 and 120');
  }
  if (typeof customPrompt !== 'string' || customPrompt.length > 4000) {
    throw new Error('customPrompt must be a string of at most 4000 characters');
  }
  const preferences = customPrompt.trim();
  return {
    systemPrompt: DEFAULT_PRESENCE_PROMPT + (preferences ? `\n\nUser style preferences (subject to the rules above):\n${preferences}` : ''),
    prompt: JSON.stringify({agent: labels[input.agent], assistantResponse: Array.from(input.response).slice(0, SOURCE_MAX_LENGTH).join('')}),
    schema: {
      type: 'object', additionalProperties: false,
      properties: {
        topic: {type: 'string', minLength: 2, maxLength},
        subtitle: {type: 'string', maxLength},
      },
      required: ['topic', 'subtitle'],
    },
  };
}
