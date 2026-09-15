import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import {SessionStore} from '../dist/store.js';
import {SummaryGeneration, generateSummary} from '../dist/generation.js';
import {DEFAULT_SETTINGS, validateSettings} from '../dist/settings.js';
import {assistantText} from '../dist/completion.js';
import {hookEvent} from '../dist/adapters/hooks.js';
const event = (state, updatedAt) => ({version: 1, agent: 'codex', sessionId: 's', state, updatedAt, model: 'current-model'});
async function until(f) { for (let n = 0; n < 200; n++) { if (f()) return; await delay(5); } throw new Error('Timed out'); }

test('completed responses generate summaries with the current model; duplicate idle events do not cancel them', async t => {
  const store = new SessionStore(); store.update(event('idle', 1000), 1000);
  let resolve; let calls = 0;
  const generation = new SummaryGeneration(store, async (_agent, text, _signal, context) => {
    calls++; assert.equal(text, 'Completed a reconnection test'); assert.equal(context.model, 'current-model');
    return await new Promise(r => { resolve = r; });
  }, () => {});
  t.after(() => generation.close());
  generation.submit('codex:s', 'Completed a reconnection test');
  store.update(event('idle', 2000), 2000); generation.reconcile();
  generation.submit('codex:s', 'Completed a reconnection test');
  resolve({topic: 'Testing reconnection behavior', subtitle: 'Checking resumed activity updates'});
  await until(() => generation.completed === 1);
  assert.equal(calls, 1); assert.equal(store.select().summary.topic, 'Testing reconnection behavior');
  assert.equal('response' in store.select(), false);
});
test('new work cancels a pending summary and cannot overwrite manual content', async t => {
  const store = new SessionStore(); store.update(event('idle', 1000), 1000);
  let resolve;
  const generation = new SummaryGeneration(store, async () => await new Promise(r => { resolve = r; }), () => {});
  t.after(() => generation.close());
  generation.submit('codex:s', 'Old response');
  store.update(event('working', 2000), 2000); generation.reconcile();
  resolve({topic: 'Old summary', subtitle: ''});
  await until(() => generation.discarded === 1);
  assert.equal(store.select().summary, undefined);
});
test('timeouts preserve previous summaries and do not expose provider errors', async t => {
  const store = new SessionStore(); store.update(event('idle', 1000), 1000);
  store.setSummary('codex:s', {topic: 'Previous summary', subtitle: ''}, 1000, 1000);
  const generation = new SummaryGeneration(store, async (_a, _s, signal) => await new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new Error('private response or API key')));
  }), () => {}, 10);
  t.after(() => generation.close()); generation.submit('codex:s', 'Next response');
  await until(() => generation.failed === 1);
  assert.equal(store.select().summary.topic, 'Previous summary');
  assert.equal(generation.lastError, 'Summary request timed out');
});
test('OpenAI-compatible service honors model override, sends prompt preferences, validates output', async t => {
  const requests = []; let reply = {topic: 'Reviewing code', subtitle: 'Checking edge cases'};
  const server = createServer((req, res) => {
    let body = ''; req.on('data', chunk => { body += chunk; }); req.on('end', () => {
      requests.push({body: JSON.parse(body), path: req.url}); res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({choices: [{message: {content: JSON.stringify(reply)}}]}));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => server.close(r)));
  const settings = {...DEFAULT_SETTINGS, service: 'openai-compatible', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKeyEnv: '', model: 'chosen-model', customPrompt: 'Use concise English'};
  const result = await generateSummary(settings, 'pi', 'Reviewed edge cases', new AbortController().signal, {model: 'session-model'});
  assert.equal(result.topic, 'Reviewing code'); assert.equal(requests[0].body.model, 'chosen-model');
  assert.equal(requests[0].path, '/v1/chat/completions');
  assert.ok(requests[0].body.messages[0].content.includes('Use concise English'));
  reply = {topic: 'x'.repeat(73), subtitle: ''};
  await assert.rejects(generateSummary(settings, 'pi', 'Reviewed edge cases', new AbortController().signal), /exceeds/);
  await assert.rejects(generateSummary({...settings, model: ''}, 'pi', 'response', new AbortController().signal), /Current model unavailable/);
});
test('completion extraction excludes reasoning and tools; Stop uses assistant output and current model', () => {
  const message = {role: 'assistant', content: [{type: 'thinking', thinking: 'private'}, {type: 'toolCall', arguments: {secret: 'value'}}, {type: 'text', text: 'Public-facing response'}]};
  assert.equal(assistantText(message), 'Public-facing response');
  assert.equal(assistantText({...message, role: 'tool'}), '');
  const e = hookEvent('codex', {session_id: 's', hook_event_name: 'Stop', last_assistant_message: 'Completed a fix', model: 'session-model'}, 1000);
  assert.equal(e.response, 'Completed a fix'); assert.equal(e.model, 'session-model');
  assert.equal(hookEvent('codex', {session_id: 's', hook_event_name: 'StopFailure', last_assistant_message: 'error'}, 1000).response, undefined);
});
test('settings keep secrets out of config and validate service URLs', () => {
  assert.equal(validateSettings({}).service, 'session');
  assert.throws(() => validateSettings({apiKey: 'secret'}));
  assert.throws(() => validateSettings({baseUrl: 'http://example.com/v1'}));
  assert.throws(() => validateSettings({baseUrl: 'https://user:password@example.com/v1'}));
  assert.throws(() => validateSettings({enabled: 'false'}));
});
