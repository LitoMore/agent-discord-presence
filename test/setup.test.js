import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, readdir, rm, symlink, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {planSetup, applySetup} from '../dist/setup.js';
import {planUninstall, uninstallIntegration} from '../dist/uninstall.js';
import {catalogFor, selectEvents, validateEvents, selectionWarnings} from '../dist/integration-events.js';
import {adapterEvents, parseEntry, policyPath} from '../dist/integration-config.js';
import {handleDesktopRequest, integrationInstructions} from '../dist/desktop.js';
import pi from '../dist/adapters/pi.js';
import {AgentPresence} from '../dist/adapters/opencode.js';
import {apply as harness} from '../dist/adapters/deepseek-harness.js';
import {startDaemon} from '../dist/daemon.js';
import {request} from '../dist/client.js';

const exec = promisify(execFile);
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'adp-setup-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  return {dir, path: join(dir, 'integration.json')};
}
async function until(fn) { for (let i = 0; i < 200; i++) { if (fn()) return; await delay(10); } assert.fail('Timed out'); }

test('agent catalogs validate profiles, required callbacks, pairs, unsupported APIs, and degraded hook configurations', () => {
  for (const agent of ['codex', 'claude-code', 'opencode', 'pi', 'deepseek-harness']) {
    const full = selectEvents(agent);
    const light = selectEvents(agent, {profile: 'lightweight'});
    assert.ok(light.length < full.length);
    for (const e of catalogFor(agent).filter(e => e.required)) assert.ok(light.includes(e.id));
    assert.deepEqual(validateEvents(agent, light), light);
    assert.throws(() => selectEvents(agent, {events: ['unknown']}), /Unsupported events/);
    assert.throws(() => selectEvents(agent, {profile: 'lightweight', events: full}), /either/);
  }
  assert.throws(() => selectEvents('pi', {events: ['session_start']}), /Required/);
  assert.throws(() => selectEvents('pi', {events: [...selectEvents('pi', {profile: 'lightweight'}), 'ui_prompt_start']}), /requires/);
  assert.throws(() => selectEvents('codex', {events: ['StopFailure']}), /Unsupported/);
  assert.equal(catalogFor('pi').some(e => e.id === 'agent_end'), false);
  assert.ok(selectionWarnings('codex', ['SessionStart']).length >= 2);
});

for (const agent of ['codex', 'claude-code']) {
  test(`${agent} setup reconciles selected hooks and partial removal preserves all other events and settings`, async t => {
    const {path, dir} = await fixture(t);
    const unrelated = {type: 'command', command: 'echo unrelated'};
    const original = {model: 'keep', hooks: {Stop: [{matcher: 'keep', hooks: [unrelated]}]}};
    const source = JSON.stringify(original);
    await writeFile(path, source);
    let plan = await planSetup(agent, {path, profile: 'lightweight'});
    assert.deepEqual(plan.installedEvents, []);
    assert.equal(plan.status, 'ready');
    assert.equal(await readFile(path, 'utf8'), source);
    let result = await applySetup(agent, {path, events: plan.selectedEvents}, plan.revision);
    assert.equal(result.changed, true);
    assert.equal(await readFile(result.backup, 'utf8'), source);
    let config = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(config.model, 'keep');
    assert.deepEqual(config.hooks.Stop[0], original.hooks.Stop[0]);
    assert.match(config.hooks.Stop[1].hooks[0].command, /^ADP_CONFIG=/);
    plan = await planSetup(agent, {path});
    assert.equal(plan.status, 'unchanged');
    const files = await readdir(dir);
    assert.equal((await applySetup(agent, {path, events: plan.selectedEvents}, plan.revision)).changed, false);
    assert.deepEqual(await readdir(dir), files);
    plan = await planSetup(agent, {path, events: ['UserPromptSubmit', 'Stop', 'PreToolUse']});
    assert.deepEqual(plan.added, ['PreToolUse']);
    assert.ok(plan.removed.includes('SessionStart'));
    await applySetup(agent, {path, events: plan.selectedEvents}, plan.revision);
    const preview = await planUninstall(agent, path, ['PreToolUse']);
    assert.deepEqual(preview.selectedEvents, ['PreToolUse']);
    await uninstallIntegration(agent, path, preview.revision, ['PreToolUse']);
    config = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(config.hooks.PreToolUse, undefined);
    assert.ok(config.hooks.UserPromptSubmit);
    assert.equal(config.hooks.Stop.length, 2);
    assert.deepEqual(config.hooks.Stop[0], original.hooks.Stop[0]);
    assert.deepEqual((await planSetup(agent, {path})).selectedEvents, ['UserPromptSubmit', 'Stop']);
    assert.equal((await planUninstall(agent, path, [])).status, 'not-found');
  });
}

test('new setup creates directories, rejects links and custom code, and never applies a stale preview', async t => {
  const {path, dir} = await fixture(t);
  const nested = join(dir, 'new', 'plugins', 'entry.ts');
  const plan = await planSetup('pi', {path: nested, profile: 'lightweight'});
  assert.equal((await applySetup('pi', {path: nested, events: plan.selectedEvents}, plan.revision)).changed, true);
  const parsed = parseEntry(await readFile(nested, 'utf8'), 'pi');
  assert.deepEqual(parsed.events, plan.selectedEvents);
  await writeFile(path, '{}');
  const stale = await planSetup('codex', {path, events: ['Stop']});
  await writeFile(path, '{"keep":true}');
  await assert.rejects(applySetup('codex', {path, events: ['Stop']}, stale.revision), /changed/);
  assert.equal(await readFile(path, 'utf8'), '{"keep":true}');
  const link = join(dir, 'link'); await symlink(path, link);
  assert.equal((await planSetup('codex', {path: link})).status, 'manual');
  await writeFile(path, 'export const custom = true;');
  assert.equal((await planSetup('pi', {path})).status, 'manual');
  assert.equal(await readFile(path, 'utf8'), 'export const custom = true;');
});

for (const agent of ['pi', 'opencode']) {
  test(`${agent} selectively disables paired optional callbacks and retains required lifecycle callbacks`, async t => {
    const {path} = await fixture(t);
    const plan = await planSetup(agent, {path, profile: 'recommended'});
    await applySetup(agent, {path, events: plan.selectedEvents}, plan.revision);
    const waiting = catalogFor(agent).filter(e => e.capability === 'waiting').map(e => e.id);
    await assert.rejects(planUninstall(agent, path, [waiting[0]]), /requires/);
    const preview = await planUninstall(agent, path, waiting);
    assert.equal(preview.partial, true);
    assert.deepEqual(preview.selectedEvents, waiting);
    await uninstallIntegration(agent, path, preview.revision, waiting);
    const text = await readFile(path, 'utf8');
    const parsed = parseEntry(text, agent);
    for (const id of waiting) assert.equal(parsed.events.includes(id), false);
    for (const e of catalogFor(agent).filter(e => e.required)) assert.ok(parsed.events.includes(e.id));
    await assert.rejects(planUninstall(agent, path, [catalogFor(agent).find(e => e.required).id]), /Required/);
    const custom = text + '\nexport const keep = true;';
    await writeFile(path, custom);
    assert.equal((await planUninstall(agent, path, waiting)).status, 'manual');
    assert.equal(await readFile(path, 'utf8'), custom);
  });
}

test('desktop selected setup and removal round-trip with revision checks and selected-only generated prompts', async t => {
  const {path} = await fixture(t);
  const response = await handleDesktopRequest({action: 'integration', agent: 'codex', path, events: ['Stop', 'SessionEnd'], language: 'zh-CN'});
  assert.equal(response.ok, true);
  assert.deepEqual(Object.keys(JSON.parse(response.integration.content).hooks), ['Stop', 'SessionEnd']);
  assert.ok(response.integration.prompt.includes(path));
  assert.ok(response.integration.prompt.includes(response.integration.content));
  assert.equal((await handleDesktopRequest({action: 'setup', agent: 'codex', path, events: ['Stop', 'SessionEnd']})).ok, false);
  const applied = await handleDesktopRequest({action: 'setup', agent: 'codex', path, events: ['Stop', 'SessionEnd'], revision: response.setupPlan.revision});
  assert.equal(applied.setupResult.changed, true);
  const removal = await handleDesktopRequest({action: 'uninstall-preview', agent: 'codex', path, events: ['Stop']});
  assert.deepEqual(removal.uninstallPlan.selectedEvents, ['Stop']);
  assert.equal((await handleDesktopRequest({action: 'uninstall', agent: 'codex', path, events: ['SessionEnd'], revision: removal.uninstallPlan.revision})).ok, false);
  assert.equal((await handleDesktopRequest({action: 'uninstall', agent: 'codex', path, events: ['Stop'], revision: removal.uninstallPlan.revision})).uninstallResult.removed, true);
  assert.deepEqual(Object.keys(JSON.parse(await readFile(path, 'utf8')).hooks), ['SessionEnd']);
  assert.throws(() => integrationInstructions('pi', 'en', {events: ['Stop']}), /Unsupported/);
});

test('CLI scripts select profiles or exact events and non-TTY invocations never wait for answers', async t => {
  const {path, dir} = await fixture(t);
  const run = (...args) => exec(process.execPath, ['dist/cli.js', ...args], {env: {...process.env, ADP_CONFIG: join(dir, 'config.json')}});
  assert.match((await run('events', 'pi')).stdout, /agent_settled.*required/);
  assert.deepEqual(Object.keys(JSON.parse((await run('config', 'codex', '--events', 'Stop,SessionEnd')).stdout).hooks), ['Stop', 'SessionEnd']);
  assert.match((await run('setup', 'codex', '--path', path, '--events', 'Stop,SessionEnd', '--dry-run')).stdout, /Add: Stop, SessionEnd/);
  await assert.rejects(stat(path), {code: 'ENOENT'});
  await run('setup', 'codex', '--path', path, '--events', 'Stop,SessionEnd');
  await run('uninstall', 'codex', '--path', path, '--events', 'Stop');
  assert.deepEqual(Object.keys(JSON.parse(await readFile(path, 'utf8')).hooks), ['SessionEnd']);
  await assert.rejects(run('setup', 'codex'), /requires a terminal/);
  await assert.rejects(run('uninstall', 'codex', '--interactive'), /requires a terminal/);
  await assert.rejects(run('config', 'pi', '--events', 'Stop'), /Unsupported/);
  await assert.rejects(run('setup', 'codex', '--events', ''), /requires a comma/);
  await exec(process.execPath, [join(process.cwd(), 'dist/cli.js'), 'setup', 'deepseek-harness', '--profile', 'lightweight'], {cwd: dir, env: {...process.env, ADP_CONFIG: 'config.json'}});
  const policy = JSON.parse(await readFile(join(dir, 'integrations', 'deepseek-harness.json'), 'utf8'));
  assert.deepEqual(policy.events, selectEvents('deepseek-harness', {profile: 'lightweight'}));
});

test('lightweight adapters omit optional behavior but preserve reporter lifecycle and cleanup', async t => {
  const {dir} = await fixture(t);
  const previous = process.env.AGENT_PRESENCE_SOCKET;
  process.env.AGENT_PRESENCE_SOCKET = join(dir, 'service.sock');
  const daemon = await startDaemon({path: process.env.AGENT_PRESENCE_SOCKET, dryRun: true, log() {}});
  t.after(async () => { await daemon.close(); if (previous === undefined) delete process.env.AGENT_PRESENCE_SOCKET; else process.env.AGENT_PRESENCE_SOCKET = previous; });
  const handlers = new Map();
  pi({on(name, callback) { handlers.set(name, callback); }}, {profile: 'lightweight'});
  assert.equal(handlers.has('message_end'), false);
  assert.equal(handlers.has('ui_prompt_start'), false);
  const ctx = {sessionManager: {getSessionId: () => 'light'}, isIdle: () => true};
  await handlers.get('session_start')({}, ctx);
  handlers.get('agent_start')({}, ctx);
  await until(() => daemon.store.select()?.state === 'working');
  await handlers.get('session_shutdown')({}, ctx);
  assert.equal(daemon.store.select(), undefined);
  const plugin = await AgentPresence.withEvents({profile: 'lightweight'})({directory: dir});
  const send = (type, properties = {}) => plugin.event({event: {type, properties: {sessionID: 'light', ...properties}}});
  await send('session.status', {status: {type: 'busy'}});
  await until(() => daemon.store.select()?.state === 'working');
  await send('permission.asked', {id: 'one'});
  await send('message.updated', {info: {id: 'message', role: 'assistant'}});
  assert.equal((await request({type: 'status'})).sessions[0].state, 'working');
  await send('server.instance.disposed');
  assert.equal(daemon.store.select(), undefined);
});

test('Harness stores event policy separately, filters nested events, and always registers cleanup', async t => {
  const {dir} = await fixture(t);
  const previous = process.env.ADP_CONFIG;
  process.env.ADP_CONFIG = join(dir, 'config.json');
  t.after(() => { if (previous === undefined) delete process.env.ADP_CONFIG; else process.env.ADP_CONFIG = previous; });
  const plan = await planSetup('deepseek-harness', {events: selectEvents('deepseek-harness', {profile: 'lightweight'}).filter(id => id !== 'agent/error')});
  assert.equal(plan.kind, 'policy');
  assert.equal((await applySetup('deepseek-harness', {events: plan.selectedEvents}, plan.revision)).changed, true);
  assert.equal(adapterEvents('deepseek-harness').has('approval/asked'), false);
  const callbacks = new Map(); let cleanup;
  const previousSocket = process.env.AGENT_PRESENCE_SOCKET;
  process.env.AGENT_PRESENCE_SOCKET = join(dir, 'harness.sock');
  let generated = 0;
  const daemon = await startDaemon({path: process.env.AGENT_PRESENCE_SOCKET, dryRun: true, log() {}, generate: async () => { generated++; return {topic: 'must not generate', subtitle: ''}; }});
  t.after(async () => { await daemon.close(); if (previousSocket === undefined) delete process.env.AGENT_PRESENCE_SOCKET; else process.env.AGENT_PRESENCE_SOCKET = previousSocket; });
  harness({on(name, callback) { callbacks.set(name, callback); }, effect(fn) { cleanup = fn(); }, llm: {stream() { throw new Error('disabled reply collection must not invoke the host LLM'); }}});
  assert.ok(callbacks.has('agent/disposed')); assert.equal(typeof cleanup, 'function');
  const agent = {id: 'harness-light', status: 'idle', options: {model: 'test', provider: 'test'}};
  callbacks.get('agent/created')({agent});
  callbacks.get('agent/status')({agent, status: 'running'});
  await until(() => daemon.store.select()?.state === 'working');
  callbacks.get('session/event')({id: agent.id}, {type: 'approval/asked', data: {id: 'approval'}});
  callbacks.get('session/event')({id: agent.id}, {type: 'assistant/message', surfaceOp: 'append', data: {message: {role: 'assistant', content: [{type: 'text', text: 'must not collect'}]}}});
  assert.equal((await request({type: 'status'})).sessions[0].state, 'working');
  callbacks.get('agent/status')({agent, status: 'idle'});
  await until(() => daemon.store.select()?.state === 'idle');
  assert.equal(generated, 0);
  callbacks.get('agent/status')({agent, status: 'running'});
  await until(() => daemon.store.select()?.state === 'working');
  callbacks.get('agent/error')({agent});
  callbacks.get('agent/status')({agent, status: 'idle'});
  await until(() => daemon.store.select()?.state === 'idle');
  assert.equal((await request({type: 'status'})).sessions[0].state, 'idle');
  await cleanup();
  assert.equal(daemon.store.select(), undefined);
  const full = await planSetup('deepseek-harness', {profile: 'recommended'});
  await applySetup('deepseek-harness', {events: full.selectedEvents}, full.revision);
  const events = ['approval/asked', 'approval/decided'];
  const removal = await planUninstall('deepseek-harness', undefined, events);
  assert.equal((await uninstallIntegration('deepseek-harness', undefined, removal.revision, events)).removed, true);
  assert.equal(JSON.parse(await readFile(policyPath(), 'utf8')).events.includes('approval/asked'), false);
  assert.equal((await planUninstall('deepseek-harness')).kind, 'managed');
});
