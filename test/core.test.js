import test from 'node:test';
import assert from 'node:assert/strict';
import {SessionStore} from '../dist/store.js';
import {parseEvent} from '../dist/protocol.js';
import {activityFor} from '../dist/discord.js';
import {hookEvent} from '../dist/adapters/hooks.js';
import {Reporter} from '../dist/client.js';
const e = (sessionId, state, updatedAt = 1000, extra = {}) => ({version: 1, agent: 'codex', sessionId, state, updatedAt, ...extra});
test('working outranks idle; latest active wins; heartbeat does not steal selection', () => {
  const store = new SessionStore();
  store.update(e('a', 'working'), 1000);
  store.update(e('b', 'idle', 2000), 2000);
  assert.equal(store.select().sessionId, 'a');
  store.update(e('b', 'working', 3000), 3000);
  store.update(e('a', 'working', 1000, {heartbeat: true}), 4000);
  assert.equal(store.select().sessionId, 'b');
  store.pin('codex:a'); assert.equal(store.select().sessionId, 'a');
  store.update(e('a', 'closed', 5000), 5000);
  assert.equal(store.pinned, null); assert.equal(store.select().sessionId, 'b');
});
test('late events cannot regress or resurrect a closed session', () => {
  const store = new SessionStore();
  store.update(e('a', 'idle', 2000), 2000);
  store.update(e('a', 'working', 1000), 2001);
  assert.equal(store.select().state, 'idle');
  store.update(e('a', 'closed', 3000), 3000);
  store.update(e('a', 'working', 2000, {heartbeat: true}), 3001);
  assert.equal(store.select(), undefined);
  store.update(e('a', 'working', 4000), 4000);
  assert.equal(store.select().startedAt, 4000);
});
test('extension leases and hook expiry clear stale presence; process death clears immediately', () => {
  const store = new SessionStore(300_000, pid => pid !== 999);
  store.update(e('hook', 'working'), 1000);
  store.update(e('extension', 'working', 1000, {pid: 123}), 1000);
  store.update(e('dead', 'working', 1000, {pid: 999}), 1000);
  store.sweep(2000); assert.equal(store.sessions.has('codex:dead'), false);
  store.sweep(92_000); assert.equal(store.sessions.has('codex:extension'), false);
  assert.equal(store.select().sessionId, 'hook');
  store.sweep(302_000); assert.equal(store.select(), undefined);
});
test('protocol whitelists fields and rejects bad data', () => {
  const parsed = parseEvent(e('a', 'idle', 1000, {prompt: 'secret', cwd: '/secret'}), 1000);
  assert.equal('prompt' in parsed, false); assert.equal('cwd' in parsed, false);
  for (const extra of [{version: 2}, {agent: 'x'}, {state: 'x'}, {updatedAt: Infinity}, {pid: -1}, {sessionId: ''}]) {
    assert.throws(() => parseEvent({...e('a', 'idle'), ...extra}, 1000));
  }
});
test('a fresh daemon recovers long-running extension state on heartbeat', () => {
  const store = new SessionStore(300_000, () => true);
  store.update(e('long-run', 'working', 1000, {pid: 123, heartbeat: true}), 1_000_000);
  assert.equal(store.select().state, 'working');
  assert.equal(store.select().startedAt, 1000);
  store.sweep(1_010_000);
  assert.equal(store.select().sessionId, 'long-run');
});
test('activity retains session start through state changes and contains no session identifier', () => {
  const store = new SessionStore(); store.update(e('secret-id', 'working'), 1000);
  store.update(e('secret-id', 'idle', 3000), 3000);
  assert.deepEqual(activityFor(store.select()), {type: 0, name: 'Coding with Codex', details: 'Ready for a prompt', state: 'Codex session', timestamps: {start: 1}});
  assert.equal(activityFor(), null);
});
test('hook mapping distinguishes tool completion, compaction, and session closure', () => {
  const state = (name, extra = {}) => hookEvent('codex', {session_id: 's', hook_event_name: name, ...extra}, 1000)?.state;
  assert.equal(state('PostToolUse'), 'working');
  assert.equal(state('SessionStart', {source: 'compact'}), 'working');
  assert.equal(state('PermissionRequest'), 'waiting');
  assert.equal(state('Stop'), 'idle'); assert.equal(state('SessionEnd'), 'closed');
  assert.equal(state('SubagentStop'), undefined);
  assert.equal(state('Notification', {notification_type: 'auth_success'}), undefined);
});
test('reporter coalesces updates, closes last, and tolerates unavailable service', async () => {
  const sent = []; let release;
  const reporter = new Reporter('pi', 's', async event => {
    sent.push(event);
    if (sent.length === 1) await new Promise(resolve => { release = resolve; });
  });
  reporter.set('working'); reporter.set('waiting'); reporter.set('idle');
  const closed = reporter.close(); release(); await closed;
  assert.deepEqual(sent.map(e => e.state), ['working', 'closed']);
  assert.ok(sent[1].updatedAt > sent[0].updatedAt);
  const failing = new Reporter('pi', 's', async () => { throw new Error('offline'); });
  failing.set('working'); await failing.close();
});
