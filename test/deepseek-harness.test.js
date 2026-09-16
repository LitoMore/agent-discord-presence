import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {apply} from 'agent-discord-presence/deepseek-harness';
import {startDaemon} from '../dist/daemon.js';

async function until(predicate) {
  for (let i = 0; i < 400; i++) { if (predicate()) return; await delay(10); }
  assert.fail('Timed out waiting for presence');
}
test('Harness lifecycle, concurrent approvals, summaries, cancellation, errors and unload', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'adp-dsh-'));
  const old = process.env.AGENT_PRESENCE_SOCKET;
  process.env.AGENT_PRESENCE_SOCKET = join(dir, 'service.sock');
  const generated = [];
  const daemon = await startDaemon({path: process.env.AGENT_PRESENCE_SOCKET,
    transport: {start() {}, stop() {}, setActivity() {}, status: 'test'},
    generate: async (agent, response, _signal, context) => {
      generated.push({agent, response, ...context}); return {topic: 'Testing Harness', subtitle: 'Checking lifecycle'};
    }});
  const handlers = new Map(); let dispose;
  apply({on(event, handler) { handlers.set(event, handler); }, effect(callback) { dispose = callback(); }});
  t.after(async () => {
    await dispose(); await daemon.close();
    if (old === undefined) delete process.env.AGENT_PRESENCE_SOCKET; else process.env.AGENT_PRESENCE_SOCKET = old;
    await rm(dir, {recursive: true, force: true});
  });
  const a = {id: 'one', status: 'idle', options: {model: 'initial'}};
  const b = {id: 'two', status: 'idle', options: {}};
  const state = agent => daemon.store.sessions.get(`deepseek-harness:${agent.id}`)?.state;
  const status = (agent, status) => { agent.status = status; handlers.get('agent/status')({agent, status}); };
  const event = (type, data, surfaceOp = 'append') => handlers.get('session/event')(a, {type, data, surfaceOp});
  const message = {role: 'assistant', source: {kind: 'model', model: 'deepseek-current', provider: 'deepseek'}, content: [
    {type: 'text', text: 'Completed adapter'}, {type: 'reasoning', text: 'private reasoning'}, {type: 'tool-call', arguments: 'private args'}]};
  handlers.get('agent/created')({agent: a}); handlers.get('agent/created')({agent: b});
  await until(() => state(a) === 'idle' && state(b) === 'idle');
  status(a, 'running'); await until(() => state(a) === 'working');
  event('approval/asked', {id: 'first'}); event('approval/asked', {id: 'second'});
  event('approval/decided', {id: 'first'}); await until(() => state(a) === 'waiting');
  assert.equal(state(b), 'idle');
  event('approval/decided', {id: 'second'}); await until(() => state(a) === 'working');
  event('assistant/message', {message}); event('turn/end', {reason: {kind: 'completed'}});
  await delay(25); assert.equal(generated.length, 0);
  status(a, 'idle'); await until(() => generated.length === 1);
  assert.deepEqual(generated[0], {agent: 'deepseek-harness', response: 'Completed adapter', model: 'deepseek-current', provider: 'deepseek'});
  status(a, 'running'); event('assistant/message', {message}); event('turn/end', {reason: {kind: 'aborted'}});
  status(a, 'idle'); await until(() => state(a) === 'idle');
  status(a, 'running'); handlers.get('agent/error')({agent: a}); status(a, 'idle');
  await until(() => state(a) === 'error'); assert.equal(generated.length, 1);
  status(a, 'running'); await until(() => state(a) === 'working');
  event('assistant/message', {message}, {op: 'replace'}); status(a, 'idle');
  await until(() => state(a) === 'idle'); assert.equal(generated.length, 1);
  await handlers.get('agent/disposed')({agent: a}); assert.equal(state(a), undefined);
  await dispose(); assert.equal(daemon.store.sessions.size, 0);
});
test('Harness summary workers register no plugin effects', () => {
  const old = process.env.ADP_SUMMARY_WORKER; process.env.ADP_SUMMARY_WORKER = '1';
  try { apply({on() { assert.fail(); }, effect() { assert.fail(); }}); }
  finally { if (old === undefined) delete process.env.ADP_SUMMARY_WORKER; else process.env.ADP_SUMMARY_WORKER = old; }
});
test('Harness bundle activates the exported plugin', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const patch = await readFile(new URL(`../${pkg.dsh.bundle.patch}`, import.meta.url), 'utf8');
  assert.match(patch, /name: agent-discord-presence\/deepseek-harness/);
});

test('Harness native summaries reuse its LLM route, honor settings, and discard stale work', async t => {
  const {writeFile} = await import('node:fs/promises');
  const {DEFAULT_SETTINGS} = await import('../dist/settings.js');
  const {request} = await import('../dist/client.js');
  const dir = await mkdtemp(join(tmpdir(), 'adp-dsh-native-'));
  const oldSocket = process.env.AGENT_PRESENCE_SOCKET; const oldConfig = process.env.ADP_CONFIG;
  process.env.AGENT_PRESENCE_SOCKET = join(dir, 'service.sock'); process.env.ADP_CONFIG = join(dir, 'config.json');
  const configure = changes => writeFile(process.env.ADP_CONFIG, JSON.stringify({...DEFAULT_SETTINGS, ...changes}));
  await configure({});
  const daemon = await startDaemon({path: process.env.AGENT_PRESENCE_SOCKET,
    transport: {start() {}, stop() {}, setActivity() {}, status: 'test'}});
  const handlers = new Map(); let dispose; const calls = []; let hold = false; let release;
  apply({on(event, handler) { handlers.set(event, handler); }, effect(callback) { dispose = callback(); },
    llm: {async *stream(options) {
      calls.push(options);
      if (hold) await new Promise(resolve => { release = resolve; options.signal.addEventListener('abort', resolve, {once: true}); });
      yield {type: 'reasoning-delta', index: 0, text: 'secret reasoning'};
      const text = JSON.stringify({topic: `Harness summary ${calls.length}`, subtitle: 'Reused host credentials'});
      yield {type: 'text-delta', index: 1, text};
      yield {type: 'block-end', index: 1, block: {type: 'text', text}};
      yield {type: 'finish', reason: {kind: 'stop'}};
    }}});
  t.after(async () => {
    await dispose(); await daemon.close();
    if (oldSocket === undefined) delete process.env.AGENT_PRESENCE_SOCKET; else process.env.AGENT_PRESENCE_SOCKET = oldSocket;
    if (oldConfig === undefined) delete process.env.ADP_CONFIG; else process.env.ADP_CONFIG = oldConfig;
    await rm(dir, {recursive: true, force: true});
  });
  const agent = {id: 'native', status: 'idle', options: {model: 'old-model', provider: 'old-route'}};
  const session = () => daemon.store.sessions.get('deepseek-harness:native');
  const status = status => { agent.status = status; handlers.get('agent/status')({agent, status}); };
  async function complete() {
    status('running'); await until(() => session()?.state === 'working');
    handlers.get('session/event')(agent, {type: 'assistant/message', surfaceOp: 'append', data: {
      message: {role: 'assistant', content: [{type: 'text', text: 'Updated code'}, {type: 'reasoning', text: 'private'}],
        source: {kind: 'model', provider: 'authenticated-route', model: 'current-model'}}}});
    status('idle'); await until(() => session()?.state === 'idle');
  }
  handlers.get('agent/created')({agent});
  await complete(); await until(() => session()?.summary?.topic === 'Harness summary 1');
  assert.equal(calls[0].model, 'current-model'); assert.equal(calls[0].provider, 'authenticated-route');
  assert.equal(calls[0].tools, undefined); assert.equal(calls[0].sessionId, undefined);
  assert.equal(calls[0].messages.length, 1);
  assert.equal(JSON.stringify(calls[0].messages).includes('private'), false);
  assert.equal((await request({type: 'status'})).generation.failed, 0);
  await configure({model: 'override-model', provider: 'override-route', customPrompt: 'Write in Chinese'});
  await complete(); await until(() => session()?.summary?.topic === 'Harness summary 2');
  assert.equal(calls[1].model, 'override-model'); assert.equal(calls[1].provider, 'override-route');
  assert.match(calls[1].system, /Write in Chinese/);
  await configure({enabled: false}); await complete(); await delay(40); assert.equal(calls.length, 2);
  await configure({}); hold = true;
  await complete(); await until(() => calls.length === 3);
  await request({type: 'summary', key: 'deepseek-harness:native', summary: {topic: 'Manual title', subtitle: ''},
    expectedUpdatedAt: session().updatedAt, expectedStartedAt: session().startedAt});
  release(); await delay(40); assert.equal(session().summary.topic, 'Manual title');
  await complete(); await until(() => calls.length === 4);
  status('running'); await until(() => calls[3].signal.aborted); await delay(20);
  assert.equal(session().summary.topic, 'Manual title');
  await complete(); await until(() => calls.length === 5);
  await configure({enabled: false}); release(); await delay(40);
  assert.equal(session().summary.topic, 'Manual title');
  const {createServer} = await import('node:http');
  const external = createServer((_req, res) => res.end(JSON.stringify({choices: [{message: {
    content: JSON.stringify({topic: 'External summary', subtitle: ''}),
  }}]})));
  await new Promise(resolve => external.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => external.close(resolve)));
  await configure({service: 'openai-compatible', baseUrl: `http://127.0.0.1:${external.address().port}`, apiKeyEnv: ''});
  await complete(); await until(() => session()?.summary?.topic === 'External summary');
  assert.equal(calls.length, 5);
  await configure({}); await complete(); await until(() => calls.length === 6);
  await dispose(); assert.equal(calls[5].signal.aborted, true); assert.equal(session(), undefined);
});

test('Harness rejects incomplete, tool, oversized and invalid native summary streams', async () => {
  const {harnessSummary} = await import('../dist/native-summary.js');
  const {buildPresencePrompt} = await import('../dist/prompts.js');
  const job = {model: 'model', provider: 'route', input: buildPresencePrompt({agent: 'deepseek-harness', response: 'Done'})};
  for (const chunks of [
    [{type: 'finish', reason: {kind: 'error'}}],
    [{type: 'text-delta', index: 0, text: '{}'}],
    [{type: 'tool-call-delta'}],
    [{type: 'text-delta', index: 0, text: 'x'.repeat(16_385)}],
    [{type: 'text-delta', index: 0, text: 'not json'}, {type: 'finish', reason: {kind: 'stop'}}],
  ]) await assert.rejects(harnessSummary({async *stream() { yield* chunks; }}, job, new AbortController().signal));
});
