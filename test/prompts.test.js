import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPresencePrompt, DEFAULT_PRESENCE_PROMPT, PROMPT_PRESETS} from '../dist/prompts.js';

test('prompt builder separates source data and style preferences and bounds source without splitting Unicode', () => {
  const result = buildPresencePrompt({agent: 'pi', response: '🧋'.repeat(4001)}, {customPrompt: PROMPT_PRESETS.playful, maxLength: 60});
  assert.equal(Array.from(JSON.parse(result.prompt).assistantResponse).length, 4000);
  assert.equal(JSON.parse(result.prompt).agent, 'Pi');
  assert.ok(result.systemPrompt.startsWith(DEFAULT_PRESENCE_PROMPT));
  assert.ok(result.systemPrompt.includes(PROMPT_PRESETS.playful));
  assert.equal(result.systemPrompt.includes('🧋'), false);
  assert.equal(result.schema.properties.topic.maxLength, 60);
  assert.equal(result.schema.properties.subtitle.maxLength, 60);
  assert.equal(result.schema.additionalProperties, false);
});

test('prompt builder defaults and invalid preferences', () => {
  const input = {agent: 'codex', response: 'Discussed a possible fix; no code changed.'};
  const result = buildPresencePrompt(input);
  assert.equal(result.systemPrompt, DEFAULT_PRESENCE_PROMPT);
  assert.equal(result.schema.properties.topic.maxLength, 72);
  for (const maxLength of [0, 19, 121, 40.5, NaN]) assert.throws(() => buildPresencePrompt(input, {maxLength}));
  assert.throws(() => buildPresencePrompt(input, {customPrompt: 'x'.repeat(4001)}));
});
