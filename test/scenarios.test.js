import {ipcPath} from './ipc-path.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {scenarioSelection, scenariosFor, validateEvents} from '../dist/integration-events.js';
import {resolveSettings, validateSettings} from '../dist/settings.js';
import {planSetup, applySetup} from '../dist/setup.js';
import {handleDesktopRequest} from '../dist/desktop.js';
import {hookEvent} from '../dist/adapters/hooks.js';
import {startDaemon} from '../dist/daemon.js';
import {request} from '../dist/client.js';

const exec = promisify(execFile);
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'adp-scenes-'));
  const previous = process.env.ADP_CONFIG;
  process.env.ADP_CONFIG = join(directory, 'config.json');
  t.after(async () => {
    if (previous === undefined) delete process.env.ADP_CONFIG; else process.env.ADP_CONFIG = previous;
    await rm(directory, {recursive: true, force: true});
  });
  return directory;
}
async function until(check) {
  for (let i = 0; i < 200; i++) { if (await check()) return; await delay(5); }
  assert.fail('Timed out');
}

test('scenario combinations include dependencies and only offer supported behaviors', () => {
  for (const agent of ['codex', 'claude-code', 'opencode', 'pi', 'deepseek-harness']) {
    for (const scene of scenariosFor(agent)) {
      const result = scenarioSelection(agent, [scene.id]);
      assert.deepEqual(validateEvents(agent, result.events), result.events);
      for (const id of scene.events) assert.ok(result.events.includes(id));
      assert.deepEqual(result.summaryTriggers, scene.summaryTrigger ? [scene.summaryTrigger] : []);
    }
    assert.deepEqual(scenarioSelection(agent, ['cleanup']).summaryTriggers, []);
  }
  const tools = scenarioSelection('codex', ['work-status', 'reply-summary', 'tool-summary', 'cleanup']);
  assert.deepEqual(tools.summaryTriggers, ['reply', 'tool']);
  assert.ok(tools.events.includes('PreToolUse') && tools.events.includes('PostToolUse') && tools.events.includes('Stop'));
  assert.throws(() => scenarioSelection('pi', ['tool-summary']), /Unsupported scenarios/);
  assert.throws(() => scenarioSelection('codex', ['unknown']), /Unsupported scenarios/);
  assert.deepEqual(resolveSettings(validateSettings({})).summaryTriggers, ['reply']);
  assert.deepEqual(resolveSettings(validateSettings({summaryTriggers: ['reply'], agents: {codex: {summaryTriggers: []}}}), 'codex').summaryTriggers, []);
  for (const value of [null, 'tool', ['unknown']]) assert.throws(() => validateSettings({summaryTriggers: value}));
});

test('preview/apply saves timing, preserves advanced exclusions, and detects changed settings', {skip:process.platform==='win32'}, async t => {
  const directory = await fixture(t), path = join(directory, 'hooks.json');
  await writeFile(process.env.ADP_CONFIG, JSON.stringify({model: 'keep', agents: {pi: {customPrompt: 'Keep this'}}}));
  let plan = await planSetup('codex', {path, scenarios: ['work-status', 'reply-summary', 'tool-summary', 'cleanup']});
  assert.equal(JSON.parse(await readFile(process.env.ADP_CONFIG)).agents.codex, undefined);
  assert.ok(plan.scenarios.find(s => s.id === 'tool-summary'));
  const options = {path, events: plan.selectedEvents, summaryTriggers: plan.summaryTriggers};
  await applySetup('codex', options, plan.revision);
  const saved = JSON.parse(await readFile(process.env.ADP_CONFIG));
  assert.equal(saved.model, 'keep'); assert.deepEqual(saved.agents.pi, {customPrompt: 'Keep this'});
  assert.deepEqual(saved.agents.codex.summaryTriggers, ['reply', 'tool']);
  plan = await planSetup('codex', {path});
  assert.equal(plan.status, 'unchanged');
  // Keep the scenario's intent while deliberately excluding its input hook.
  const custom = {path, events: plan.selectedEvents.filter(id => id !== 'PreToolUse'), summaryTriggers: plan.summaryTriggers};
  plan = await planSetup('codex', custom);
  assert.ok(plan.warnings.some(w => w.includes('PreToolUse')));
  await applySetup('codex', custom, plan.revision);
  assert.equal(JSON.parse(await readFile(path)).hooks.PreToolUse, undefined);
  assert.equal((await planSetup('codex', {path})).selectedEvents.includes('PreToolUse'), false);
  const disabled = {path, events: custom.events, summaryTriggers: []};
  plan = await planSetup('codex', disabled);
  assert.equal(plan.status, 'ready'); assert.deepEqual(plan.added, []); assert.deepEqual(plan.removed, []);
  saved.customPrompt = 'Changed externally';
  await writeFile(process.env.ADP_CONFIG, JSON.stringify(saved));
  await assert.rejects(applySetup('codex', disabled, plan.revision), /changed/);
  plan = await planSetup('codex', disabled);
  await applySetup('codex', disabled, plan.revision);
  assert.deepEqual(JSON.parse(await readFile(process.env.ADP_CONFIG)).agents.codex.summaryTriggers, []);
  assert.ok(JSON.parse(await readFile(path)).hooks.Stop); // Still publishes idle state.
});

test('CLI and both desktop copy paths include summary timing', {skip:process.platform==='win32'}, async t => {
  const directory = await fixture(t), path = join(directory, 'hooks.json');
  const args = ['dist/cli.js', 'setup', 'claude-code', '--path', path, '--scenarios', 'work-status,tool-summary,cleanup'];
  const env = {...process.env};
  await exec(process.execPath, [...args, '--dry-run'], {env});
  await assert.rejects(readFile(path), {code: 'ENOENT'});
  await exec(process.execPath, args, {env});
  assert.deepEqual(JSON.parse(await readFile(process.env.ADP_CONFIG)).agents['claude-code'].summaryTriggers, ['tool']);
  const preview = await handleDesktopRequest({action: 'integration', agent: 'claude-code', path});
  assert.equal(preview.ok, true);
  assert.match(preview.integration.summaryCommand, /config set summaryTriggers.*tool.*--agent claude-code/);
  assert.ok(preview.integration.prompt.includes(preview.integration.summaryCommand));
  await exec(process.execPath, ['dist/cli.js', 'setup', 'claude-code', '--path', path, '--events', preview.setupPlan.selectedEvents.join(','), '--summary-triggers', ''], {env});
  assert.deepEqual(JSON.parse(await readFile(process.env.ADP_CONFIG)).agents['claude-code'].summaryTriggers, []);
});

test('tool summaries run while working, merge rapid calls, survive tool completion, and yield to replies', async t => {
  const directory = await fixture(t);
  await writeFile(process.env.ADP_CONFIG, JSON.stringify({summaryTriggers: ['reply', 'tool']}));
  const calls = [], path = ipcPath(directory, 'service.sock');
  const daemon = await startDaemon({path, dryRun: true, log() {}, generate: async (_agent, input, signal) => {
    let finish;
    const promise = new Promise(resolve => { finish = resolve; });
    calls.push({input, signal, finish});
    return promise;
  }});
  // Resolve any intentionally blocked fake generator during cleanup.
  t.after(async () => { for (const call of calls) call.finish({topic: 'Cleanup result', subtitle: ''}); await daemon.close(); });
  let timestamp = Date.now();
  const send = async (name, extra = {}) => {
    const event = hookEvent('codex', {session_id: 's', hook_event_name: name, model: 'test-model', ...extra}, ++timestamp);
    await request({type: 'event', event}, path); return event;
  };
  await send('UserPromptSubmit');
  const first = await send('PreToolUse', {tool_name: 'Read', tool_input: {secret: 'NEVER_SEND'}, tool_response: 'NEVER_SEND'});
  await until(() => calls.length === 1);
  assert.equal(daemon.store.select().state, 'working');
  assert.match(calls[0].input, /Read/); assert.doesNotMatch(calls[0].input, /NEVER_SEND/);
  assert.equal(daemon.store.select().tool, undefined);
  await send('PostToolUse', {tool_name: 'Read'});
  await send('PreToolUse', {tool_name: 'Search'});
  await send('PreToolUse', {tool_name: 'Edit'});
  assert.equal(calls.length, 1); assert.equal(calls[0].signal.aborted, false);
  calls[0].finish({topic: 'Reading source code', subtitle: ''});
  await until(() => calls.length === 2);
  assert.match(calls[1].input, /Edit/); assert.doesNotMatch(calls[1].input, /Search/);
  assert.equal(daemon.store.select().summary.topic, 'Reading source code');
  await send('Stop', {last_assistant_message: 'Finished reviewing the integration'});
  assert.equal(calls[1].signal.aborted, true);
  calls[1].finish({topic: 'Stale tool summary', subtitle: ''});
  await until(() => calls.length === 3);
  assert.equal(calls[2].input, 'Finished reviewing the integration');
  calls[2].finish({topic: 'Reviewing the integration', subtitle: ''});
  await until(() => daemon.store.select().summary.topic === 'Reviewing the integration');
  // Replays and heartbeats do not initiate another generation request.
  await request({type: 'event', event: first}, path);
  await send('Stop', {last_assistant_message: 'Finished reviewing the integration'});
  assert.equal(calls.length, 3);
  await send('SessionEnd');
  assert.equal(daemon.store.sessions.size, 0);
});

test('disabled tool summaries keep lifecycle updates and reject manual-summary races', async t => {
  const directory = await fixture(t), path = ipcPath(directory, 'service.sock');
  const calls = [];
  const daemon = await startDaemon({path, dryRun: true, log() {}, generate: async (_agent, input) => {
    let finish; const result = new Promise(resolve => { finish = resolve; });
    calls.push({input, finish}); return result;
  }});
  t.after(async () => { for (const call of calls) call.finish({topic: 'Cleanup', subtitle: ''}); await daemon.close(); });
  let timestamp = Date.now();
  const send = name => request({type: 'event', event: hookEvent('claude-code', {session_id: 's', hook_event_name: name, tool_name: 'Read'}, ++timestamp)}, path);
  await send('PreToolUse'); assert.equal(calls.length, 0); assert.equal(daemon.store.select().state, 'working');
  await writeFile(process.env.ADP_CONFIG, JSON.stringify({summaryTriggers: ['tool']}));
  await send('PreToolUse'); await until(() => calls.length === 1);
  const current = daemon.store.select();
  await request({type: 'summary', key: 'claude-code:s', expectedUpdatedAt: current.updatedAt, expectedStartedAt: current.startedAt,
    summary: {topic: 'Manual title', subtitle: ''}}, path);
  calls[0].finish({topic: 'Obsolete tool summary', subtitle: ''});
  await until(async () => (await request({type: 'status'}, path)).generation.discarded === 1);
  assert.equal(daemon.store.select().summary.topic, 'Manual title');
});
