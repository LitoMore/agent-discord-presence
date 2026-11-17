import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, symlink, rm} from 'node:fs/promises';
import {join, delimiter} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {nodeExecutable, nodeCommand, nodeLauncher} from '../dist/node-runtime.js';
import {quote} from '../dist/integration-config.js';
import {planSetup, applySetup, hookCommand} from '../dist/setup.js';
import {removeHooks} from '../dist/uninstall.js';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'adp-node-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  return directory;
}

test('preserves installer symlinks and custom PATH entries instead of resolved version directories', {skip: process.platform === 'win32'}, async t => {
  const directory = await fixture(t);
  const version = join(directory, 'versions', 'v22', 'node');
  const bin = join(directory, 'custom installer', 'bin');
  await mkdir(join(directory, 'versions', 'v22'), {recursive: true});
  await mkdir(bin, {recursive: true});
  await writeFile(version, '', {mode: 0o755});
  await symlink(version, join(bin, 'node'));
  assert.equal(nodeExecutable({PATH: ['relative', join(directory, 'missing'), bin].join(delimiter)}, version), join(bin, 'node'));
  assert.equal(nodeExecutable({PATH: '', ADP_NODE_HINT: join(bin, 'node')}, version), join(bin, 'node'));
  const shim = join(directory, 'manager-shim'); await writeFile(shim, '#!/bin/sh\n', {mode: 0o755});
  assert.equal(nodeExecutable({ADP_NODE_HINT: shim}, version), shim);
  assert.equal(nodeExecutable({ADP_NODE_HINT: join(directory, 'missing')}, version), version);
  assert.equal(nodeExecutable({PATH: ''}, version), version);
  assert.equal(nodeExecutable({ADP_NODE: '/custom/node'}, version), '/custom/node');
});

test('launcher follows Node version switches, preserves stdin/arguments, and falls back without PATH', {skip: process.platform === 'win32'}, async t => {
  const directory = await fixture(t);
  const script = join(directory, "cli with ' quotes.mjs");
  await writeFile(script, 'let input=""; for await (const chunk of process.stdin) input+=chunk; console.log(JSON.stringify({input,args:process.argv.slice(2)}));');
  const command = nodeCommand(script) + ' hook codex';
  const env = {...process.env}; delete env.ADP_NODE;
  const result = spawnSync('/bin/sh', ['-c', command], {env: {...env, PATH: ''}, input: '{"test":true}', encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {input: '{"test":true}', args: ['hook', 'codex']});
  // Simulate nvm/fnm changing PATH after the saved version has been removed.
  const bin = join(directory, 'new version', 'bin'); await mkdir(bin, {recursive: true});
  await symlink(process.execPath, join(bin, 'node'));
  const args = ['-c', nodeLauncher, 'adp-node', join(directory, 'deleted-node'), script, 'hook', 'codex'];
  const switched = spawnSync('/bin/sh', args, {env: {...env, PATH: bin}, input: '{}', encoding: 'utf8'});
  assert.equal(switched.status, 0, switched.stderr);
  assert.equal(JSON.parse(switched.stdout).input, '{}');
  const overridden = spawnSync('/bin/sh', args, {env: {...env, PATH: '', ADP_NODE: process.execPath}, input: '{}', encoding: 'utf8'});
  assert.equal(overridden.status, 0, overridden.stderr);
  const invalid = spawnSync('/bin/sh', args, {env: {...env, PATH: bin, ADP_NODE: join(directory, 'invalid-override')}, encoding: 'utf8'});
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /invalid-override/);
});

test('setup refreshes stale Node commands while preserving other hooks and matcher metadata', {skip: process.platform === 'win32'}, async t => {
  const directory = await fixture(t), path = join(directory, 'hooks.json');
  const cli = new URL('../dist/cli.js', import.meta.url);
  const unrelated = {type: 'command', command: 'echo keep'};
  const original = {hooks: {Stop: [{matcher: 'keep', async: true, hooks: [
    {type: 'command', command: `'/removed/node/version/bin/node' ${quote(fileURLToPath(cli))} hook codex`, timeout: 9}, unrelated,
  ]}]}};
  await writeFile(path, JSON.stringify(original));
  const plan = await planSetup('codex', {path});
  assert.equal(plan.status, 'ready');
  assert.deepEqual(plan.added, []); assert.deepEqual(plan.removed, []);
  const result = await applySetup('codex', {path}, plan.revision);
  assert.ok(result.backup);
  const updated = JSON.parse(await readFile(path, 'utf8'));
  const group = updated.hooks.Stop[0];
  assert.equal(group.matcher, 'keep'); assert.equal(group.async, true);
  assert.equal(group.hooks[0].command, `${hookCommand()} hook codex`);
  assert.equal(group.hooks[0].timeout, 9); assert.deepEqual(group.hooks[1], unrelated);
  assert.equal((await planSetup('codex', {path})).status, 'unchanged');
  assert.deepEqual((await removeHooks(JSON.stringify(updated), 'codex')).removedEvents, ['Stop']);
});

test('only the exact generated launcher is recognized for updates and removal', {skip: process.platform === 'win32'}, async () => {
  const command = `${hookCommand()} hook codex`;
  for (const modified of [command.replace('adp_node=$1;', 'echo custom; adp_node=$1;'), command + ' && echo keep']) {
    const source = JSON.stringify({hooks: {Stop: [{hooks: [{type: 'command', command: modified}]}]}});
    const result = await removeHooks(source, 'codex');
    assert.equal(result.uncertain, true); assert.deepEqual(result.removedEvents, []);
  }
});
