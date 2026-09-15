import test from 'node:test';
import assert from 'node:assert/strict';
import {SessionStore} from '../dist/store.js';
import {activityFor} from '../dist/discord.js';
import {parseSummary} from '../dist/summary.js';
const event = (sessionId, state, updatedAt) => ({version: 1, agent: 'codex', sessionId, state, updatedAt});

test('summary titles and distinct subtitles survive lifecycle events without stealing session selection', () => {
  const store = new SessionStore();
  store.update(event('a', 'working', 1000), 1000);
  store.update(event('b', 'working', 2000), 2000);
  store.setSummary('codex:a', {topic: 'Debugging a plugin', subtitle: 'Checking reconnection behavior'}, 1000, 1000);
  assert.equal(store.select().sessionId, 'b');
  assert.equal(store.sessions.get('codex:a').lastSeen, 1000);
  store.pin('codex:a');
  assert.deepEqual(activityFor(store.select()), {type: 0, name: 'Debugging a plugin', details: 'Working', state: 'Checking reconnection behavior', timestamps: {start: 1}});
  store.update(event('a', 'waiting', 3000), 3000);
  assert.equal(activityFor(store.select()).name, 'Debugging a plugin');
  assert.equal(activityFor(store.select()).details, 'Waiting for input');
  store.update(event('a', 'idle', 4000), 4000);
  assert.equal(activityFor(store.select()).name, 'Debugging a plugin');
  store.setSummary('codex:a', null, 4000, 1000);
  assert.equal(activityFor(store.select()).name, 'Coding with Codex');
  assert.equal(activityFor(store.select()).state, 'Codex session');
});
test('summary updates reject stale generation results, closed sessions, and reused session IDs', () => {
  const store = new SessionStore(); const summary = {topic: 'Reviewing a change', subtitle: ''};
  store.update(event('a', 'working', 1000), 1000);
  store.update(event('a', 'working', 2000), 2000);
  assert.throws(() => store.setSummary('codex:a', summary, 1000, 1000), /Session changed/);
  store.update(event('a', 'closed', 3000), 3000);
  assert.throws(() => store.setSummary('codex:a', summary, 2000, 1000), /Unknown session/);
  store.update(event('a', 'working', 4000), 4000);
  assert.throws(() => store.setSummary('codex:a', summary, 4000, 1000), /Session changed/);
  assert.equal(store.select().summary, undefined);
});
test('summary validation preserves Unicode, normalizes whitespace, and omits duplicate subtitles', () => {
  assert.deepEqual(parseSummary({topic: '  Debugging presence updates\n', subtitle: ' Debugging presence updates '}), {topic: 'Debugging presence updates', subtitle: ''});
  assert.equal(parseSummary({topic: '🧋'.repeat(120), subtitle: ''}).topic, '🧋'.repeat(120));
  for (const value of [null, {topic: '', subtitle: ''}, {topic: 'x'.repeat(121), subtitle: ''}, {topic: 'ok', subtitle: 1}, {topic: 'ok', subtitle: '', prompt: 'private'}, {topic: 'ok\u0000', subtitle: ''}]) {
    assert.throws(() => parseSummary(value));
  }
});
