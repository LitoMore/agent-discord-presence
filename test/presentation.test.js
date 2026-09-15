import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSettings} from '../dist/settings.js';
import {activityFor} from '../dist/discord.js';
const session = {agent: 'codex', state: 'working', startedAt: 1000, summary: {topic: 'Reviewing code', subtitle: 'Checking edge cases'}};
test('custom presentation merges summaries, image assets, links, timers and buttons', () => {
  const {presence} = validateSettings({presence: {
    type: 3, name: '{agent}: {topic}', details: 'Stage: {phase}', state: '{subtitle}',
    assets: {large_image: 'https://example.com/art.png', small_image: '123', large_text: '{topic}', small_text: '{agent}', large_url: 'https://example.com'},
    buttons: [{label: 'Project', url: 'https://example.com'}], timestamps: {start: 10, end: 100},
    status_display_type: 1, details_url: 'https://example.com/details', state_url: 'https://example.com/state', party: {size: [1, 2]},
  }});
  const result = activityFor(session, presence);
  assert.equal(result.name, 'Codex: Reviewing code');
  assert.equal(result.details, 'Stage: Working');
  assert.equal(result.assets.large_image, 'https://example.com/art.png');
  assert.equal(result.assets.small_image, '123');
  assert.equal(result.assets.large_text, 'Reviewing code');
  assert.deepEqual(result.timestamps, {start: 10, end: 100});
  assert.deepEqual(result.buttons, [{label: 'Project', url: 'https://example.com'}]);
  assert.equal(result.type, 3);
  assert.deepEqual(result.party, {size: [1, 2]});
  assert.equal(result.status_display_type, 1);
  assert.equal(activityFor({...session, summary: {topic: 'New topic', subtitle: ''}}, {name: 'Fixed title'}).name, 'Fixed title');
  assert.deepEqual(activityFor(session, {timestamps: null, details: null, state: null, assets: null}), {name: 'Reviewing code', type: 0});
  assert.equal(activityFor(undefined, presence), null);
});
test('presentation rejects malformed fields and does not split Unicode templates', () => {
  for (const presence of [null, {unknown: true}, {type: 4}, {name: ''}, {assets: {small_image: '/local.png'}},
    {assets: {large_image: 'http://example.com/a.png'}}, {assets: {large_image: 'https://user:pass@example.com/a'}},
    {assets: {unknown: 'x'}}, {buttons: [{label: 'Missing URL'}]}, {buttons: Array(3).fill({label: 'Link', url: 'https://example.com'})},
    {timestamps: {start: 100, end: 10}}, {party: {size: [3, 2]}}, {state: 'x\n'}]) assert.throws(() => validateSettings({presence}));
  const output = activityFor({...session, summary: {topic: '🧋'.repeat(120), subtitle: ''}}, {name: '{topic} {topic}'});
  assert.equal(Array.from(output.name).length, 128);
  assert.equal(output.name.includes('\uFFFD'), false);
});
