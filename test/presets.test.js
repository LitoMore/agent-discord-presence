import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {getPreset, mergePreset, PRESETS} from '../dist/presets.js';
import {validateSettings} from '../dist/settings.js';

test('presets merge nested settings, replace arrays/null, and reject invalid input', () => {
  const original = validateSettings({model: 'custom-model', presence: {
    assets: {small_image: 'existing'}, buttons: [{label: 'Site', url: 'https://example.com'}],
  }});
  const result = mergePreset(original, getPreset('codex'));
  assert.equal(result.model, 'custom-model');
  assert.equal(result.presence.assets.small_image, 'existing');
  assert.match(result.presence.assets.large_image, /codex.png$/);
  assert.equal(original.presence.assets.large_image, undefined);
  const cleared = mergePreset(result, {presence: {assets: null, buttons: []}});
  assert.equal(cleared.presence.assets, null);
  assert.deepEqual(cleared.presence.buttons, []);
  for (const bad of [{unknown: true}, {presence: {assets: {large_image: '/local.png'}}}, {maxLength: 0}, 'old format']) {
    assert.throws(() => mergePreset(original, bad));
  }
  for (const name of Object.keys(PRESETS)) assert.doesNotThrow(() => getPreset(name));
  assert.throws(() => getPreset('__proto__'));
});

test('preset CLI previews without writing, persists merges, and leaves settings intact on failure', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'adp-presets-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const config = join(dir, 'config.json');
  const initial = JSON.stringify({model: 'existing', presence: {assets: {small_image: 'small'}}});
  await writeFile(config, initial);
  const cli = (...args) => JSON.parse(execFileSync(process.execPath, ['dist/cli.js', ...args], {
    env: {...process.env, ADP_CONFIG: config}, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8',
  }));
  assert.ok(cli('preset', 'list').includes('codex'));
  assert.deepEqual(cli('preset', 'show', 'codex'), getPreset('codex'));
  assert.equal(await readFile(config, 'utf8'), initial);
  const prompt = cli('prompt', 'minimal');
  assert.equal(prompt.config.customPrompt, getPreset('minimal').customPrompt);
  assert.equal(await readFile(config, 'utf8'), initial);
  const applied = cli('preset', 'apply', 'codex');
  assert.equal(applied.model, 'existing');
  assert.equal(applied.presence.assets.small_image, 'small');
  assert.deepEqual(JSON.parse(await readFile(config, 'utf8')), applied);
  cli('preset', 'apply', 'codex');
  const saved = await readFile(config, 'utf8');
  assert.deepEqual(JSON.parse(saved), applied);
  assert.throws(() => cli('preset', 'apply', 'missing'));
  assert.equal(await readFile(config, 'utf8'), saved);
});
