import {ipcPath} from './ipc-path.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, writeFile, readdir, rm, stat, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {hookConfig} from '../dist/adapters/hooks.js';
import {integrationInstructions, handleDesktopRequest} from '../dist/desktop.js';
import {planUninstall, uninstallIntegration} from '../dist/uninstall.js';
import {parseEntry} from '../dist/integration-config.js';

const exec = promisify(execFile);
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'adp-uninstall-'));
  const previous=process.env.ADP_CONFIG;process.env.ADP_CONFIG=join(dir,'config.json');
  t.after(async()=>{if(previous===undefined)delete process.env.ADP_CONFIG;else process.env.ADP_CONFIG=previous;await rm(dir,{recursive:true,force:true});});
  return {dir, path: join(dir, 'integration.json')};
}
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
async function installationFixture(dir) {
  const root = join(dir, "Agent's Discord Presence Dev.app", 'Contents', 'Resources');
  await mkdir(join(root, 'dist', 'adapters'), {recursive: true});
  await writeFile(join(root, 'package.json'), JSON.stringify({name: 'agent-discord-presence', bin: {'agent-discord-presence': 'dist/cli.js'}}));
  await writeFile(join(root, 'dist', 'cli.js'), 'throw new Error("must never execute during detection");');
  for (const agent of ['opencode', 'pi']) await writeFile(join(root, 'dist', 'adapters', `${agent}.js`), 'throw new Error("must never execute during detection");');
  return root;
}

for (const agent of ['codex', 'claude-code']) {
  test(`${agent} recognizes setup environment prefixes and a different verified desktop installation`, async t => {
    const {path, dir} = await fixture(t);
    const root = await installationFixture(dir);
    const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
    const environment = `ADP_CONFIG=${quote(join(dir, 'config.json'))} AGENT_PRESENCE_SOCKET=${quote(ipcPath(dir, 'service.sock'))}`;
    for (const command of [
      `${environment} ${quote(process.execPath)} ${quote(cli)}`,
      `${environment} '/older/node/version/bin/node' ${quote(join(root, 'dist', 'cli.js'))}`,
      `/usr/bin/env ${environment} node ${quote(join(root, 'dist', 'cli.js'))}`,
      `env ${environment} adp`,
      `${environment} agent-discord-presence`,
    ]) {
      const config = hookConfig(agent, command);
      const unrelated = {type: 'command', command: 'echo preserve this'};
      config.hooks.Stop[0].hooks.push(unrelated);
      const source = JSON.stringify(config);
      await writeFile(path, source);
      const plan = await planUninstall(agent, path);
      assert.equal(plan.status, 'ready', command);
      assert.equal(plan.manualReview, false, command);
      assert.equal(plan.count, Object.keys(config.hooks).length);
      const result = await uninstallIntegration(agent, path, plan.revision);
      assert.equal(result.removed, true);
      assert.equal(await readFile(result.backup, 'utf8'), source);
      assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), {hooks: {Stop: [{hooks: [unrelated]}]}});
    }
  });
}

test('other installations require matching package metadata and unsafe wrappers stay manual', async t => {
  const {path, dir} = await fixture(t);
  const root = await installationFixture(dir);
  const command = `node ${quote(join(root, 'dist', 'cli.js'))}`;
  for (const prefix of ['NODE_OPTIONS=--require=custom.js ', 'env --chdir=/tmp ', 'sh -c ']) {
    await writeFile(path, JSON.stringify(hookConfig('codex', prefix + command)));
    assert.equal((await planUninstall('codex', path)).status, 'manual');
  }
  for (const manifest of [
    {name: 'another-package', bin: {'agent-discord-presence': 'dist/cli.js'}},
    {name: 'agent-discord-presence', bin: {'agent-discord-presence': 'dist/custom.js'}},
    {name: 'agent-discord-presence'},
  ]) {
    await writeFile(join(root, 'package.json'), JSON.stringify(manifest));
    const source = JSON.stringify(hookConfig('codex', command));
    await writeFile(path, source);
    assert.equal((await uninstallIntegration('codex', path)).plan.status, 'manual');
    assert.equal(await readFile(path, 'utf8'), source);
  }
});

for (const agent of ['opencode', 'pi']) {
  test(`${agent} recognizes an entry from another verified installation`, async t => {
    const {path, dir} = await fixture(t);
    const root = await installationFixture(dir);
    const name = agent === 'pi' ? 'default' : 'AgentPresence';
    const source = `export { ${name} } from ${JSON.stringify(pathToFileURL(join(root, 'dist', 'adapters', `${agent}.js`)).href)};`;
    await writeFile(path, source);
    const result = await uninstallIntegration(agent, path);
    assert.equal(result.removed, true);
    assert.equal(await readFile(result.backup, 'utf8'), source);
    await assert.rejects(stat(path), {code: 'ENOENT'});
    await writeFile(path, source);
    const events = agent === 'pi' ? ['ui_prompt_start', 'ui_prompt_end'] : ['permission.asked', 'permission.replied'];
    assert.equal((await uninstallIntegration(agent, path, undefined, events)).removed, true);
    const updated = parseEntry(await readFile(path, 'utf8'), agent);
    assert.equal(updated.source, new URL(`../dist/adapters/${agent}.js`, import.meta.url).href);
  });
}

for (const agent of ['codex', 'claude-code']) {
  test(`${agent} removal preserves mixed hooks and unrelated settings, backs up original bytes, and is idempotent`, {skip:process.platform==='win32'}, async t => {
    const {dir, path} = await fixture(t);
    const config = JSON.parse(integrationInstructions(agent).content);
    const expectedCount = Object.keys(config.hooks).length + 1;
    const custom = {type: 'command', command: 'echo keep', timeout: 30};
    config.hooks.Stop[0].hooks.push(custom);
    config.hooks.Stop[0].matcher = 'keep matcher';
    config.hooks.Stop.push({hooks: [{type: 'command', command: `adp hook ${agent}`}, custom], async: true});
    config.hooks.CustomEvent = [{hooks: [custom]}];
    config.hooks.EmptyEvent = [];
    config.model = 'keep model';
    config.permissions = {allow: ['Read'], deny: ['Bash(rm:*)']};
    const source = JSON.stringify(config, null, '\t') + '\n';
    await writeFile(path, source, {mode: 0o640});
    const plan = await planUninstall(agent, path);
    assert.equal(plan.count, expectedCount);
    assert.equal(plan.status, 'ready');
    assert.equal(await readFile(path, 'utf8'), source);
    assert.deepEqual(await readdir(dir), ['integration.json']);
    const result = await uninstallIntegration(agent, path, plan.revision);
    assert.equal(result.removed, true);
    assert.equal(await readFile(result.backup, 'utf8'), source);
    assert.equal((await stat(result.backup)).mode & 0o777, 0o600);
    assert.equal((await stat(path)).mode & 0o777, 0o640);
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), {
      hooks: {Stop: [{...config.hooks.Stop[0], hooks: [custom]}, {hooks: [custom], async: true}], CustomEvent: config.hooks.CustomEvent, EmptyEvent: []},
      model: config.model, permissions: config.permissions,
    });
    assert.equal((await uninstallIntegration(agent, path)).removed, false);
    assert.equal((await readdir(dir)).length, 2);
  });
}

test('unrecognized commands, shell wrappers, other agents, and old paths are preserved', async t => {
  const {path} = await fixture(t);
  const hooks = [
    'echo agent-discord-presence hook codex',
    'adp hook codex && echo keep',
    'agent-discord-presence hook claude-code',
    "node '/old/agent-discord-presence/dist/cli.js' hook codex",
    'sh -c "adp hook codex"',
    "'node' \"$(echo something)\" hook codex",
    'adp\nhook codex',
  ].map(command => ({type: 'command', command}));
  const source = JSON.stringify({hooks: {Stop: [{hooks}]}});
  await writeFile(path, source);
  assert.equal((await planUninstall('codex', path)).status, 'manual');
  assert.equal((await uninstallIntegration('codex', path)).removed, false);
  assert.equal(await readFile(path, 'utf8'), source);
  hooks.push({type: 'command', command: 'adp hook codex'});
  await writeFile(path, JSON.stringify({hooks: {Stop: [{hooks}]}}));
  const result = await uninstallIntegration('codex', path);
  assert.equal(result.plan.count, 1);
  assert.match(result.plan.note, /Additional possible Presence hooks/);
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')).hooks.Stop[0].hooks, hooks.slice(0, -1));
});

for (const agent of ['opencode', 'pi']) {
  test(`${agent} removes only a recognized entry and preserves custom code`, async t => {
    const {path, dir} = await fixture(t);
    const source = integrationInstructions(agent).content + '\n';
    await writeFile(path, source);
    const result = await uninstallIntegration(agent, path);
    assert.equal(result.removed, true);
    await assert.rejects(stat(path), {code: 'ENOENT'});
    assert.equal(await readFile(result.backup, 'utf8'), source);
    assert.equal((await uninstallIntegration(agent, path)).plan.status, 'not-found');
    assert.equal((await readdir(dir)).length, 1);
    for (const custom of [source + 'export const keep = true;', source.replace('file:', 'file:/old'), 'export const unrelated = true;']) {
      await writeFile(path, custom);
      assert.equal((await uninstallIntegration(agent, path)).plan.status, 'manual');
      assert.equal(await readFile(path, 'utf8'), custom);
    }
    const name = agent === 'pi' ? 'default' : 'AgentPresence';
    await writeFile(path, `export { ${name} } from 'agent-discord-presence/${agent}';`);
    assert.equal((await uninstallIntegration(agent, path)).removed, true);
  });
}

test('invalid configurations, links, and stale confirmations never modify the target', async t => {
  const {path, dir} = await fixture(t);
  for (const source of ['{invalid', '[]', '{"hooks":[]}', '{"hooks":{"Stop":[{"hooks":"bad"}]}}']) {
    await writeFile(path, source);
    assert.equal((await uninstallIntegration('codex', path)).plan.status, 'manual');
    assert.equal(await readFile(path, 'utf8'), source);
    assert.deepEqual(await readdir(dir), ['integration.json']);
  }
  const source = JSON.stringify(hookConfig('codex'));
  await writeFile(path, source);
  const plan = await planUninstall('codex', path);
  await writeFile(path, source + '\n');
  await assert.rejects(uninstallIntegration('codex', path, plan.revision), /changed/);
  assert.equal(await readFile(path, 'utf8'), source + '\n');
  assert.deepEqual(await readdir(dir), ['integration.json']);
  const link = join(dir, 'link');
  if(process.platform!=='win32'){await symlink(path, link);
  assert.equal((await uninstallIntegration('codex', link)).plan.status, 'manual');}
  assert.equal(await readFile(path, 'utf8'), source + '\n');
  assert.equal((await planUninstall('pi', dir)).status, 'manual');
});

test('desktop previews and confirms the same scoped removal, and rejects stale or missing revisions', async t => {
  const {path} = await fixture(t);
  await writeFile(path, JSON.stringify(hookConfig('codex')));
  const preview = await handleDesktopRequest({action: 'uninstall-preview', agent: 'codex', path});
  assert.equal(preview.ok, true);
  assert.equal(preview.uninstallPlan.status, 'ready');
  assert.equal((await handleDesktopRequest({action: 'uninstall', agent: 'codex', path})).ok, false);
  await writeFile(path, JSON.stringify(hookConfig('codex')) + '\n');
  const stale = await handleDesktopRequest({action: 'uninstall', agent: 'codex', path, revision: preview.uninstallPlan.revision});
  assert.equal(stale.ok, false);
  assert.match(stale.error, /changed/);
  const fresh = await handleDesktopRequest({action: 'uninstall-preview', agent: 'codex', path});
  const result = await handleDesktopRequest({action: 'uninstall', agent: 'codex', path, revision: fresh.uninstallPlan.revision});
  assert.equal(result.uninstallResult.removed, true);
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), {hooks: {}});
  for (const bad of [{agent: 'unknown'}, {agent: 'codex', path: {}}, {agent: 'pi', path: ''}]) {
    assert.equal((await handleDesktopRequest({action: 'uninstall-preview', ...bad})).ok, false);
  }
  const harness = await handleDesktopRequest({action: 'uninstall-preview', agent: 'deepseek-harness'});
  assert.equal(harness.uninstallPlan.kind, 'managed');
  assert.equal(harness.uninstallPlan.status, 'manual');
});

test('CLI supports dry runs and explicit project files without changing defaults', async t => {
  const {path, dir} = await fixture(t);
  const source = JSON.stringify(hookConfig('claude-code'));
  await writeFile(path, source);
  const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
  const run = (...args) => exec(process.execPath, [cli, ...args], {cwd: dir});
  assert.match((await run('uninstall', 'claude-code', '--path', path, '--dry-run')).stdout, /Would remove/);
  assert.equal(await readFile(path, 'utf8'), source);
  assert.deepEqual(await readdir(dir), ['integration.json']);
  assert.match((await run('uninstall', 'claude-code', '--path', path)).stdout, /Backup:/);
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), {hooks: {}});
  assert.match((await run('uninstall', 'claude-code', '--path', path)).stdout, /No recognized integration/);
  await assert.rejects(run('uninstall', 'unknown'), /Use uninstall/);
  await assert.rejects(run('uninstall', 'codex', 'extra'), /Use uninstall/);
  await assert.rejects(run('uninstall', 'deepseek-harness'), error => error.code === 1 && /Harness plugin manager/.test(error.stdout));
});
