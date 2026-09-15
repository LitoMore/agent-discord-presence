import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {DiscordClient, Decoder, frame} from '../dist/discord.js';
import {startDaemon} from '../dist/daemon.js';
import {request} from '../dist/client.js';
import pi from '../dist/adapters/pi.js';
import {AgentPresence} from '../dist/adapters/opencode.js';
async function until(fn, ms = 4000) {
  const start = Date.now(); while (!fn()) { if (Date.now() - start > ms) throw new Error('Condition timed out'); await delay(10); }
}
test('decoder handles split and concatenated frames; refuses oversized frames', () => {
  const decoder = new Decoder(); const one = frame(1, {evt: 'READY'}); const two = frame(3, {nonce: 'ping'});
  assert.deepEqual(decoder.feed(one.subarray(0, 5)), []);
  assert.deepEqual(decoder.feed(Buffer.concat([one.subarray(5), two])), [{op: 1, body: {evt: 'READY'}}, {op: 3, body: {nonce: 'ping'}}]);
  const bad = Buffer.alloc(8); bad.writeUInt32LE(2 ** 30, 4); assert.throws(() => decoder.feed(bad));
});
test('Discord handshake, activity ACK, ping, coalescing, reconnect replay, and clear', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'adp-rpc-')); const path = join(dir, 'discord.sock');
  const messages = []; const sockets = new Set(); let connections = 0;
  const server = createServer(socket => {
    connections++; sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
    const decoder = new Decoder();
    socket.on('data', data => {
      for (const packet of decoder.feed(data)) {
        messages.push(packet);
        if (packet.op === 0) {
          assert.equal(packet.body.client_id, '1549160807705870418');
          const ready = frame(1, {evt: 'READY'}); socket.write(ready.subarray(0, 3)); socket.write(ready.subarray(3));
          socket.write(frame(3, {nonce: 'alive'}));
        }
        if (packet.body.cmd === 'SET_ACTIVITY') socket.write(frame(1, {cmd: 'SET_ACTIVITY', nonce: packet.body.nonce, data: null}));
      }
    });
  });
  await new Promise(resolve => server.listen(path, resolve));
  const client = new DiscordClient('1549160807705870418', [path], 50);
  t.after(async () => { client.stop(); for (const s of sockets) s.destroy(); await new Promise(r => server.close(r)); await rm(dir, {recursive: true, force: true}); });
  const activity = {type: 0, name: 'Debugging a plugin', details: 'Coding with Pi', state: 'Working', timestamps: {start: 1000}};
  client.setActivity(activity); client.start();
  await until(() => messages.some(m => m.body.cmd === 'SET_ACTIVITY'));
  await until(() => messages.some(m => m.op === 4 && m.body.nonce === 'alive'));
  client.setActivity({...activity, state: 'Waiting'}); client.setActivity({...activity, state: 'Idle'});
  await until(() => messages.some(m => m.body.args?.activity?.state === 'Idle'));
  assert.equal(messages.some(m => m.body.args?.activity?.state === 'Waiting'), false);
  for (const socket of sockets) socket.destroy();
  await until(() => connections >= 2 && messages.filter(m => m.body.args?.activity?.state === 'Idle').length >= 2);
  client.stop(); await until(() => messages.some(m => m.body.args?.activity === null));
});
test('daemon and real CLI hooks; adapters emit events and release session resources', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'adp-daemon-')); const path = join(dir, 'presence.sock');
  const activity = []; const transport = {status: 'test', start() {}, stop() {}, setActivity(a) { activity.push(a); }};
  const generated = [];
  const daemon = await startDaemon({path, transport, generate: async (agent, response, _signal, context) => {
    generated.push({agent, response, model: context.model});
    return {topic: 'Reviewing a code change', subtitle: 'Checking event handling'};
  }});
  const old = process.env.AGENT_PRESENCE_SOCKET; process.env.AGENT_PRESENCE_SOCKET = path;
  t.after(async () => { if (old === undefined) delete process.env.AGENT_PRESENCE_SOCKET; else process.env.AGENT_PRESENCE_SOCKET = old; await daemon.close(); await rm(dir, {recursive: true, force: true}); });
  await assert.rejects(startDaemon({path, transport}), /already running/);
  async function hook(name, extra = {}, agent = 'codex') {
    const child = spawn(process.execPath, ['dist/cli.js', 'hook', agent], {env: {...process.env}, stdio: ['pipe', 'pipe', 'pipe']});
    let output = ''; child.stdout.on('data', d => { output += d; }); child.stderr.on('data', d => { output += d; });
    child.stdin.end(JSON.stringify({session_id: 'cli', hook_event_name: name, prompt: 'never publish this', ...extra}));
    const code = await new Promise(resolve => child.on('close', resolve)); assert.equal(code, 0); assert.equal(output, '');
  }
  await hook('UserPromptSubmit');
  assert.equal((await request({type: 'status'}, path)).selected, 'codex:cli');
  assert.equal(activity.at(-1).details, 'Working');
  const summaryProcess = spawn(process.execPath, ['dist/cli.js', 'summary', 'codex:cli', 'Debugging presence updates', 'Checking reconnect recovery'], {env: {...process.env}, stdio: 'pipe'});
  let summaryError = ''; summaryProcess.stderr.on('data', d => { summaryError += d; });
  assert.equal(await new Promise(resolve => summaryProcess.on('close', resolve)), 0, summaryError);
  assert.equal(activity.at(-1).name, 'Debugging presence updates');
  assert.equal(activity.at(-1).details, 'Working');
  assert.equal(activity.at(-1).state, 'Checking reconnect recovery');
  await hook('Stop'); assert.equal(activity.at(-1).details, 'Ready for a prompt');
  assert.equal(activity.at(-1).name, 'Debugging presence updates');
  await hook('SessionEnd'); assert.equal(activity.at(-1), null);
  await hook('Stop', {last_assistant_message: 'Reviewed event handling', model: 'codex-current'});
  await until(() => generated.length === 1);
  assert.equal(activity.at(-1).name, 'Reviewing a code change');
  await hook('SessionEnd');
  const handlers = new Map(); pi({on(name, handler) { handlers.set(name, handler); }});
  const ctx = {sessionManager: {getSessionId: () => 'pi-session'}, isIdle: () => true, model: {id: 'pi-current', provider: 'test-provider'}};
  await handlers.get('session_start')({}, ctx); handlers.get('agent_start')({}, ctx);
  await until(() => daemon.store.select()?.state === 'working');
  assert.equal(handlers.has('agent_end'), false);
  handlers.get('ui_prompt_start')({}, ctx); await until(() => daemon.store.select()?.state === 'waiting');
  handlers.get('message_end')({message: {role: 'assistant', content: [{type: 'thinking', thinking: 'private reasoning'}, {type: 'text', text: 'Reviewed event handling'}]}}, ctx);
  handlers.get('ui_prompt_end')({}, ctx); handlers.get('agent_settled')({}, ctx);
  await until(() => daemon.store.select()?.state === 'idle');
  await until(() => generated.length === 2);
  await handlers.get('session_shutdown')({}, ctx); assert.equal(daemon.store.select(), undefined);
  const plugin = await AgentPresence({directory: '/private-project'});
  const event = (type, properties) => plugin.event({event: {type, properties: {sessionID: 'oc', ...properties}}});
  await event('session.status', {status: {type: 'busy'}}); await until(() => daemon.store.select()?.state === 'working');
  await event('permission.asked', {id: 'p1'}); await event('permission.asked', {id: 'p2'});
  await event('permission.replied', {requestID: 'p1'}); await until(() => daemon.store.select()?.state === 'waiting');
  await event('permission.replied', {requestID: 'p2'}); await until(() => daemon.store.select()?.state === 'working');
  await event('message.updated', {info: {sessionID: 'oc', id: 'assistant-message', role: 'assistant', modelID: 'opencode-current', providerID: 'test-provider'}});
  await event('message.part.updated', {part: {sessionID: 'oc', messageID: 'assistant-message', id: 'text-part', type: 'text', text: 'Reviewed event handling'}});
  await event('session.idle', {}); await until(() => daemon.store.select()?.state === 'idle');
  await until(() => generated.length === 3);
  assert.deepEqual(generated.map(g => g.model), ['codex-current', 'pi-current', 'opencode-current']);
  assert.equal(JSON.stringify(generated).includes('private reasoning'), false);
  await event('session.deleted', {}); assert.equal(daemon.store.select(), undefined);
  await hook('Stop', {last_assistant_message: 'Reviewed event handling', model: 'claude-current'}, 'claude-code');
  await until(() => generated.length === 4);
  assert.equal(generated.at(-1).model, 'claude-current');
  await hook('SessionEnd', {}, 'claude-code');
  assert.equal(daemon.store.select(), undefined);
  await assert.rejects(request({type: 'event', event: {version: 5}}, path), /Unsupported/);
  assert.equal(JSON.stringify(activity).includes('private-project'), false);
  assert.equal(JSON.stringify(activity).includes('never publish'), false);
});

test('CLI stop cancels generation, clears transport, closes the socket, and succeeds when already stopped', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'adp-stop-')); const path = join(dir, 'presence.sock');
  let stopped = 0; let signal;
  const activity = [];
  const daemon = await startDaemon({path,
    transport: {status: 'test', start() {}, stop() { stopped++; activity.push(null); }, setActivity(a) { activity.push(a); }},
    generate: async (_agent, _response, abortSignal) => {
      signal = abortSignal;
      await new Promise(resolve => abortSignal.addEventListener('abort', resolve, {once: true}));
      return {topic: 'Must not publish', subtitle: ''};
    },
  });
  t.after(async () => { await daemon.close(); await rm(dir, {recursive: true, force: true}); });
  await request({type: 'event', event: {version: 1, agent: 'codex', sessionId: 'stop-test', state: 'idle', updatedAt: Date.now(), response: 'Completed a change', model: 'test-model'}}, path);
  await until(() => !!signal);
  async function stop() {
    const child = spawn(process.execPath, ['dist/cli.js', 'stop', '--socket', path], {stdio: ['ignore', 'pipe', 'pipe']});
    let output = ''; let error = '';
    child.stdout.on('data', d => { output += d; }); child.stderr.on('data', d => { error += d; });
    assert.equal(await new Promise(resolve => child.on('close', resolve)), 0, error);
    return output;
  }
  assert.match(await stop(), /Presence service stopped/);
  await daemon.close();
  assert.equal(signal.aborted, true);
  assert.equal(stopped, 1);
  assert.equal(activity.at(-1), null);
  assert.equal(activity.some(a => a?.name === 'Must not publish'), false);
  await assert.rejects(request({type: 'status'}, path), e => ['ENOENT', 'ECONNREFUSED'].includes(e.code));
  assert.match(await stop(), /not running/);
  const replacement = await startDaemon({path, dryRun: true, log() {}});
  await replacement.close();
});

test('background start releases the terminal, preserves options, reports failures, and supports stop', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'adp-background-')); const path = join(dir, 'presence.sock');
  t.after(async () => {
    try { await request({type: 'stop'}, path, 10_000); } catch {}
    await rm(dir, {recursive: true, force: true});
  });
  async function cli(args) {
    const child = spawn(process.execPath, ['dist/cli.js', ...args, '--socket', path], {stdio: ['ignore', 'pipe', 'pipe']});
    let output = ''; let error = '';
    const timer = setTimeout(() => child.kill(), 15_000);
    child.stdout.on('data', d => { output += d; }); child.stderr.on('data', d => { error += d; });
    const code = await new Promise(resolve => child.on('close', resolve));
    clearTimeout(timer);
    return {code, output, error};
  }
  const started = await cli(['start', '-b', '--dry-run', '--stale-minutes', '1']);
  assert.equal(started.code, 0, started.error);
  assert.match(started.output, /started in background.*PID \d+/);
  assert.match(started.output, /Log:/);
  const status = await request({type: 'status'}, path);
  assert.equal(status.discord, 'dry-run');
  assert.notEqual(status.pid, process.pid);
  const duplicate = await cli(['start', '--background', '--dry-run']);
  assert.equal(duplicate.code, 1);
  assert.match(duplicate.error, /already running/);
  assert.equal((await request({type: 'status'}, path)).pid, status.pid);
  assert.equal((await cli(['stop'])).code, 0);
  const invalid = await cli(['start', '-b', '--client-id', 'invalid']);
  assert.equal(invalid.code, 1);
  assert.match(invalid.error, /Invalid Discord Application ID/);
  await assert.rejects(request({type: 'status'}, path));
});

test('presence config hot reloads assets and preserves the last valid configuration', async t => {
  const {writeFile} = await import('node:fs/promises');
  const dir = await mkdtemp(join(tmpdir(), 'adp-assets-')); const path = join(dir, 'presence.sock');
  const config = join(dir, 'config.json'); const oldConfig = process.env.ADP_CONFIG;
  process.env.ADP_CONFIG = config;
  const activity = [];
  const daemon = await startDaemon({path, transport: {status: 'test', start() {}, stop() {}, setActivity(a) { activity.push(a); }}});
  t.after(async () => { await daemon.close(); if (oldConfig === undefined) delete process.env.ADP_CONFIG; else process.env.ADP_CONFIG = oldConfig; await rm(dir, {recursive: true, force: true}); });
  async function configure(...args) {
    const child = spawn(process.execPath, ['dist/cli.js', 'config', ...args], {env: {...process.env}, stdio: ['ignore', 'ignore', 'pipe']});
    let error = ''; child.stderr.on('data', d => { error += d; });
    assert.equal(await new Promise(resolve => child.on('close', resolve)), 0, error);
  }
  await request({type: 'event', event: {version: 1, agent: 'codex', sessionId: 'assets', state: 'working', updatedAt: Date.now()}}, path);
  await configure('set', 'presence.assets.large_image', 'https://example.com/image.png');
  await configure('set', 'presence.assets.small_image', '123');
  await configure('set', 'presence.name', 'Fixed title');
  await configure('set', 'presence.timestamps', 'null');
  await until(() => activity.at(-1)?.assets?.large_image === 'https://example.com/image.png');
  let status = await request({type: 'status'}, path);
  assert.equal(status.activity.name, 'Fixed title');
  assert.equal(status.activity.assets.small_image, '123');
  assert.equal(status.activity.timestamps, undefined);
  await writeFile(config, '{broken');
  status = await request({type: 'status'}, path);
  assert.match(status.settingsError, /Invalid settings/);
  assert.equal(status.activity.name, 'Fixed title');
  await writeFile(config, JSON.stringify({presence: {name: 'Fixed title'}}));
  await configure('unset', 'presence.name');
  status = await request({type: 'status'}, path);
  assert.equal(status.activity.name, 'Coding with Codex');
  assert.equal(status.activity.assets, undefined);
  assert.equal(status.settingsError, null);
});
