import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {getPreset, getPresets, mergePreset, PRESETS} from '../dist/presets.js';
import {validateSettings, resolveSettings} from '../dist/settings.js';
import {agents, labels} from '../dist/protocol.js';

test('agent icons are automatic fallbacks and explicit image settings win', () => {
  const config = validateSettings({});
  const images = new Set();
  for (const agent of agents) {
    const effective = resolveSettings(config, agent);
    assert.deepEqual(effective.presence.assets, getPreset(agent).presence.assets);
    assert.equal(effective.presence.assets.large_text, labels[agent]);
    images.add(effective.presence.assets.large_image);
  }
  assert.equal(images.size, agents.length);
  assert.deepEqual(config, {});
  assert.equal(resolveSettings(validateSettings({presence: {assets: {large_image: 'global'}}}), 'pi').presence.assets.large_image, 'global');
  const scoped = validateSettings({presence: {assets: {large_image: 'global', small_image: 'badge'}}, agents: {pi: {presence: {assets: {large_image: 'custom'}}}}});
  assert.deepEqual(resolveSettings(scoped, 'pi').presence.assets, {large_image: 'custom', large_text: 'Pi', small_image: 'badge'});
  assert.equal(resolveSettings(validateSettings({presence: {assets: null}}), 'codex').presence.assets, null);
  assert.equal(resolveSettings(validateSettings({agents: {pi: {presence: {assets: null}}}}), 'pi').presence.assets, null);
});

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

test('ordered presets combine identities and styles with later fields winning', () => {
  const combined = getPresets(['codex', 'minimal']);
  assert.deepEqual(combined, {...getPreset('codex'), ...getPreset('minimal')});
  assert.equal(getPresets(['minimal', 'playful']).customPrompt, getPreset('playful').customPrompt);
  assert.equal(getPresets(['playful', 'minimal']).customPrompt, getPreset('minimal').customPrompt);
  assert.equal(getPresets(['minimal', 'default']).customPrompt, '');
  assert.equal(getPresets(['codex', 'pi']).presence.assets.large_text, 'Pi');
  assert.deepEqual(getPresets([]), {});
  assert.deepEqual(resolveSettings(validateSettings({presets: ['codex', 'minimal']})).presence, combined.presence);
  for (const presets of ['minimal', null, [1], ['missing'], ['__proto__']]) {
    assert.throws(() => validateSettings({presets}));
    assert.throws(() => validateSettings({agents: {codex: {presets}}}));
  }
});

test('all explicit settings override global and agent presets, with agent overrides last', () => {
  const config = validateSettings({presets: ['codex', 'playful'], customPrompt: 'Manual',
    presence: {assets: {small_image: 'badge'}}, agents: {
      codex: {presets: ['pi', 'minimal'], presence: {assets: {large_text: 'Custom'}}},
      pi: {presets: ['minimal'], customPrompt: 'Agent manual', presence: {assets: null}},
    }});
  const codex = resolveSettings(config, 'codex');
  assert.equal(codex.customPrompt, 'Manual');
  assert.deepEqual(codex.presence.assets, {...getPreset('pi').presence.assets, small_image: 'badge', large_text: 'Custom'});
  assert.equal(resolveSettings(config, 'pi').customPrompt, 'Agent manual');
  assert.equal(resolveSettings(config, 'pi').presence.assets, null);
  assert.equal(resolveSettings(validateSettings({presets: ['playful'], agents: {codex: {presets: ['minimal']}}}), 'codex').customPrompt, getPreset('minimal').customPrompt);
});

test('CLI persists ordered selections, supports replacement and removal, and preserves manual settings', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'adp-preset-selection-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const path = join(dir, 'config.json');
  const cli = (...args) => JSON.parse(execFileSync(process.execPath, ['dist/cli.js', ...args], {
    env: {...process.env, ADP_CONFIG: path}, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8',
  }));
  assert.deepEqual(cli('preset', 'show', 'codex', 'minimal'), getPresets(['codex', 'minimal']));
  // Saving an unrelated field must not freeze default values above the presets.
  cli('config', 'set', 'model', 'manual-model');
  cli('preset', 'apply', 'codex', 'minimal');
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), {model: 'manual-model', presets: ['codex', 'minimal']});
  assert.equal(cli('config', 'show').customPrompt, getPreset('minimal').customPrompt);
  cli('config', 'set', 'customPrompt', 'Manual');
  cli('preset', 'apply', 'minimal', 'playful');
  assert.equal(cli('config', 'show').customPrompt, 'Manual');
  assert.equal(cli('config', 'unset', 'customPrompt').customPrompt, getPreset('playful').customPrompt);
  cli('preset', 'apply', 'codex', 'minimal', '--agent', 'codex');
  assert.equal(cli('config', 'show', '--agent', 'codex').customPrompt, getPreset('minimal').customPrompt);
  assert.equal(cli('config', 'show', '--agent', 'pi').customPrompt, getPreset('playful').customPrompt);
  const saved = await readFile(path, 'utf8');
  for (const args of [
    ['preset', 'apply', 'codex', 'missing'], ['preset', 'apply', 'minimal', 'missing', '--agent', 'codex'],
    ['config', 'set', 'presets', '["missing"]'], ['preset', 'apply'],
  ]) assert.throws(() => cli(...args));
  assert.equal(await readFile(path, 'utf8'), saved);
  cli('config', 'set', 'presets', '["playful","minimal"]');
  assert.equal(cli('config', 'show').customPrompt, getPreset('minimal').customPrompt);
  cli('config', 'set', 'presets', '[]', '--agent', 'codex');
  cli('config', 'unset', 'presets');
  assert.equal(cli('config', 'show', '--agent', 'codex').customPrompt, '');
  assert.equal(cli('config', 'show').model, 'manual-model');
});
