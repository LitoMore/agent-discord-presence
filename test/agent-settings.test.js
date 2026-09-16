import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import {validateSettings, resolveSettings} from '../dist/settings.js';
import {startDaemon} from '../dist/daemon.js';
import {request} from '../dist/client.js';

async function until(fn) {
  for (let i = 0; i < 400; i++) { if (fn()) return; await delay(10); }
  assert.fail('Timed out');
}
test('agent overrides stay sparse, inherit nested defaults, and validate independently', () => {
  const config = validateSettings({model: 'shared', presence: {assets: {large_image: 'large', small_image: 'small'}, buttons: [{label: 'Docs', url: 'https://example.com'}]},
    agents: {codex: {model: '', presence: {assets: {large_image: 'codex'}, buttons: []}}, 'deepseek-harness': {enabled: false, presence: {assets: null}}}});
  assert.equal(resolveSettings(config, 'codex').model, '');
  assert.deepEqual(resolveSettings(config, 'codex').presence.assets, {large_image: 'codex', small_image: 'small', large_text: 'Codex'});
  assert.deepEqual(resolveSettings(config, 'codex').presence.buttons, []);
  assert.equal(resolveSettings(config, 'deepseek-harness').presence.assets, null);
  assert.equal(resolveSettings(config, 'pi').model, 'shared');
  assert.equal(resolveSettings(config, 'pi').enabled, true);
  assert.deepEqual(config.agents.codex, {model: '', presence: {assets: {large_image: 'codex'}, buttons: []}});
  for (const agents of [{unknown: {}}, {codex: null}, {codex: {enabled: 'false'}}, {codex: {agents: {}}}, {codex: {secret: 'x'}}, {codex: {presence: {assets: {invalid: true}}}}]) {
    assert.throws(() => validateSettings({agents}));
  }
});
test('CLI scoped set/unset/show and presets preserve other agents and global defaults', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'adp-agent-config-')); t.after(() => rm(dir, {recursive: true, force: true}));
  const path = join(dir, 'config.json');
  await writeFile(path, JSON.stringify({customPrompt: 'Global style', agents: {'deepseek-harness': {customPrompt: '中文'}}}));
  const cli = (...args) => JSON.parse(execFileSync(process.execPath, ['dist/cli.js', ...args], {encoding: 'utf8', env: {...process.env, ADP_CONFIG: path}, stdio: ['ignore', 'pipe', 'pipe']}));
  assert.equal(cli('config', 'set', 'enabled', 'false', '--agent', 'codex').enabled, false);
  cli('config', 'set', 'maxLength', '60', '--agent', 'codex');
  cli('config', 'set', 'presence.assets.large_image', 'codex', '--agent', 'codex');
  cli('preset', 'apply', 'minimal', '--agent', 'codex');
  assert.equal(cli('config', 'show', '--agent', 'deepseek-harness').customPrompt, '中文');
  assert.equal(cli('config', 'show', '--agent', 'pi').customPrompt, 'Global style');
  assert.equal(cli('config', 'show').enabled, true);
  cli('config', 'set', 'customPrompt', 'Updated global');
  assert.equal(cli('config', 'unset', 'customPrompt', '--agent', 'codex').customPrompt, 'Updated global');
  const saved = await readFile(path, 'utf8');
  assert.equal(JSON.parse(saved).agents.codex.maxLength, 60);
  assert.throws(() => cli('config', 'set', 'maxLength', 'bad', '--agent', 'codex'));
  assert.throws(() => cli('config', 'show', '--agent', 'unknown'));
  assert.equal(await readFile(path, 'utf8'), saved);
});
test('simultaneous Codex and Harness sessions select their own model, service, prompt and presentation', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'adp-multi-'));
  const previous = process.env.ADP_CONFIG; process.env.ADP_CONFIG = join(dir, 'config.json');
  const bodies = [];
  const http = createServer((req, res) => {
    let body = ''; req.on('data', data => { body += data; });
    req.on('end', () => { bodies.push(JSON.parse(body)); res.end(JSON.stringify({choices: [{message: {content: '{"topic":"Codex result","subtitle":"External service"}'}}]})); });
  });
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  const config = {enabled: false, presence: {assets: {small_image: 'shared'}}, agents: {
    codex: {enabled: true, service: 'openai-compatible', baseUrl: `http://127.0.0.1:${http.address().port}`, apiKeyEnv: '', model: 'codex-override', customPrompt: 'Codex English', presence: {name: 'Codex card', assets: {large_image: 'codex'}}},
    'deepseek-harness': {enabled: true, service: 'session', customPrompt: 'Harness 中文', presence: {name: 'Harness card', assets: {large_image: 'deepseek'}}},
  }};
  await writeFile(process.env.ADP_CONFIG, JSON.stringify(config));
  const path = join(dir, 'service.sock');
  const daemon = await startDaemon({path, transport: {status: 'test', start() {}, stop() {}, setActivity() {}}});
  t.after(async () => {
    await daemon.close(); await new Promise(resolve => http.close(resolve));
    if (previous === undefined) delete process.env.ADP_CONFIG; else process.env.ADP_CONFIG = previous;
    await rm(dir, {recursive: true, force: true});
  });
  let timestamp = Date.now();
  const event = (agent, state, response) => request({type: 'event', nativeSummary: agent === 'deepseek-harness', event: {
    version: 1, agent, sessionId: 'same-id', state, updatedAt: ++timestamp, model: 'session-model', provider: 'host-route', response,
  }}, path);
  await event('codex', 'idle', 'Codex completed');
  await until(() => daemon.store.sessions.get('codex:same-id')?.summary);
  assert.equal(bodies[0].model, 'codex-override'); assert.match(bodies[0].messages[0].content, /Codex English/);
  const {nativeSummary: job} = await event('deepseek-harness', 'idle', 'Harness completed');
  assert.equal(job.model, 'session-model'); assert.equal(job.provider, 'host-route');
  assert.match(job.input.systemPrompt, /Harness 中文/); assert.doesNotMatch(job.input.systemPrompt, /Codex English/);
  let status = await request({type: 'status'}, path);
  assert.equal(status.sessions.length, 2); assert.equal(status.activity.name, 'Harness card');
  assert.deepEqual(status.activity.assets, {large_image: 'deepseek', small_image: 'shared', large_text: 'DeepSeek Harness'});
  assert.equal(status.agentSettings.codex.service, 'openai-compatible');
  // Another agent's policy change must not invalidate the pending Harness result.
  config.agents.codex.customPrompt = 'New Codex prompt';
  await writeFile(process.env.ADP_CONFIG, JSON.stringify(config));
  await request({type: 'native-summary', job, summary: {topic: 'Harness result', subtitle: ''}}, path);
  await event('codex', 'working'); status = await request({type: 'status'}, path);
  assert.equal(status.activity.name, 'Codex card'); assert.equal(status.activity.assets.large_image, 'codex');
  const {nativeSummary: stale} = await event('deepseek-harness', 'idle', 'Second Harness reply');
  config.agents['deepseek-harness'].enabled = false;
  await writeFile(process.env.ADP_CONFIG, JSON.stringify(config));
  await assert.rejects(request({type: 'native-summary', job: stale, summary: {topic: 'Stale result', subtitle: ''}}, path), /stale/);
  const disabled = await event('deepseek-harness', 'idle', 'Disabled Harness reply'); assert.equal(disabled.nativeSummary, undefined);
  assert.equal(daemon.store.sessions.get('deepseek-harness:same-id').summary.topic, 'Harness result');
  await event('codex', 'idle', 'Codex still enabled'); await until(() => bodies.length === 2);
});
