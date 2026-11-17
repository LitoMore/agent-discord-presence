import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {setTimeout as delay} from 'node:timers/promises';
import {parseGithubSource, extractGithubArchive} from '../dist/github-plugin.js';
import {installPluginSource, pluginInstallState, installFinished} from '../dist/plugin-install.js';
import {installPlugin, changePlugin, listPlugins, getPlugin, pluginStatePath} from '../dist/agent-plugins.js';
import {handleDesktopRequest} from '../dist/desktop.js';

const commit = 'a'.repeat(40);
function archive(entries) {
  const chunks = [];
  for (const {path, data = '', type = '0', link = ''} of entries) {
    const content = Buffer.from(data), h = Buffer.alloc(512);
    h.write(path, 0, 100); h.write('0000600\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
    h.write(content.length.toString(8).padStart(11, '0') + '\0', 124);
    h.write('00000000000\0', 136); h.fill(32, 148, 156); h.write(type, 156); h.write(link, 157, 100); h.write('ustar\0', 257);
    h.write([...h].reduce((a, b) => a + b, 0).toString(8).padStart(6, '0') + '\0 ', 148);
    chunks.push(h, content, Buffer.alloc((512 - content.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]));
}
function pluginArchive(extra = {}) {
  return archive([
    {path: 'repo-snapshot/adp-plugin.json', data: JSON.stringify({apiVersion: 1, id: 'orbit', name: 'Orbit', version: '1.0.0', extension: 'adapter.mjs', ...extra})},
    {path: 'repo-snapshot/adapter.mjs', data: 'throw new Error("Installation must never execute this file");'},
  ]);
}
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'adp-install-test-'));
  const old = {ADP_CONFIG: process.env.ADP_CONFIG, AGENT_PRESENCE_SOCKET: process.env.AGENT_PRESENCE_SOCKET};
  const originalFetch = globalThis.fetch;
  process.env.ADP_CONFIG = join(dir, 'config.json');
  process.env.AGENT_PRESENCE_SOCKET = process.platform === 'win32' ? `\\\\.\\pipe\\adp-install-${process.pid}` : join(dir, 'missing.sock');
  t.after(async () => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(old)) {if (value === undefined) delete process.env[key]; else process.env[key] = value;}
    await rm(dir, {recursive: true, force: true});
  });
  return dir;
}
function github(tar, inspect = () => {}) {
  globalThis.fetch = async (url, options) => {
    inspect(url, options);
    if (url.startsWith('https://api.github.com/')) return new Response(JSON.stringify([{sha: commit}]));
    assert.equal(url, `https://codeload.github.com/owner/repo/tar.gz/${commit}`);
    return new Response(tar, {headers: {'content-length': String(tar.length)}});
  };
}
async function settled() {
  for (let i = 0; i < 200; i++) {
    const state = pluginInstallState();
    if (state && installFinished(state)) return state;
    await delay(10);
  }
  assert.fail('installation did not settle');
}

test('GitHub specs support refs without accepting URLs, extra path segments, or empty refs', () => {
  assert.deepEqual(parseGithubSource('github:owner/repo'), {owner: 'owner', repo: 'repo', ref: undefined});
  assert.equal(parseGithubSource('github:owner/repo#feature/plugins').ref, 'feature/plugins');
  for (const bad of ['github:owner/repo#', 'github:owner/repo/dir', 'https://github.com/owner/repo', 'github:owner/..', 'github:owner/repo#tag#other', 'github:owner/repo#bad\nref']) assert.throws(() => parseGithubSource(bad));
});

test('GitHub install pins the resolved commit, reports real phases and preserves source metadata', async t => {
  const dir = await fixture(t), phases = [], requests = [];
  github(pluginArchive(), url => requests.push(url));
  assert.equal(await installPluginSource('github:owner/repo#feature/plugins', s => phases.push(s)), 'orbit');
  assert.equal(new URL(requests[0]).searchParams.get('sha'), 'feature/plugins');
  assert.deepEqual([...new Set(phases.map(s => s.phase))], ['resolving', 'downloading', 'validating', 'installing', 'registering', 'installed']);
  assert.ok(phases.some(s => s.phase === 'downloading' && s.bytes > 0));
  assert.deepEqual(listPlugins()[0].source, {type: 'github', spec: 'github:owner/repo#feature/plugins', commit});
  assert.equal(JSON.parse(await readFile(join(getPlugin('orbit').root, '.adp-runtime.json'))).config, join(dir, 'config.json'));
  await changePlugin('orbit', 'disable'); await changePlugin('orbit', 'enable');
  assert.equal(listPlugins()[0].source.commit, commit);
  const before = await readFile(pluginStatePath(), 'utf8');
  await assert.rejects(installPluginSource('github:owner/repo'), /already installed/);
  assert.equal(await readFile(pluginStatePath(), 'utf8'), before);
  assert.equal((await readdir(join(dir, 'plugins'))).length, 1);
});

test('malformed or incompatible packages never register; network errors retain the old catalog', async t => {
  await fixture(t);
  for (const [tar, message] of [
    [pluginArchive({apiVersion: 2}), /unsupported API version/],
    [pluginArchive({extension: 'missing.mjs'}), /plugin package is incomplete/],
    [archive([{path: 'repo/README.md', data: 'not a plugin'}]), /No ADP plugin found.*adp-plugin.json/],
    [archive([{path: 'repo/adp-plugin.json', data: '{invalid'}]), /plugin manifest.*is invalid/],
    [archive([{path: 'repo/adp-plugin.json', data: 'null'}]), /Invalid plugin manifest/],
    [Buffer.from('not gzip'), /header/],
  ]) {
    github(tar); const states = [];
    await assert.rejects(installPluginSource('github:owner/repo', s => states.push(s)), message);
    assert.equal(states.at(-1).phase, 'failed'); assert.deepEqual(listPlugins(), []);
    assert.match(states.at(-1).error, message);
    assert.doesNotMatch(states.at(-1).error, /ENOENT|lstat|adp-plugin-[\w-]+\//);
  }
  github(pluginArchive()); await installPluginSource('github:owner/repo');
  const before = await readFile(pluginStatePath(), 'utf8');
  for (const [status, message] of [[404, /address and ref/], [422, /address and ref/], [409, /no commits/], [429, /rate limit/], [503, /temporarily unavailable/]]) {
    globalThis.fetch = async () => new Response('', {status});
    await assert.rejects(installPluginSource('github:owner/missing'), message);
    assert.equal(await readFile(pluginStatePath(), 'utf8'), before);
  }
  globalThis.fetch = async () => {throw new TypeError('fetch failed');};
  await assert.rejects(installPluginSource('github:owner/repo'), /Check your network connection/);
});

test('archive extraction rejects traversal, links, duplicate paths, truncation and resource overflows', async t => {
  const dir = await fixture(t), signal = new AbortController().signal;
  const malformed = [
    [{path: 'repo/../escape', data: 'x'}], [{path: '/absolute', data: 'x'}], [{path: 'repo/dir\\escape', data: 'x'}],
    [{path: 'repo/link', type: '2', link: '../../escape'}], [{path: 'repo/hard', type: '1', link: '/escape'}],
    [{path: 'repo/file'}, {path: 'repo/FILE'}], [{path: 'one/file'}, {path: 'two/other'}],
    [{path: 'repo/NUL.txt'}], [{path: 'repo/file', data: Buffer.alloc(8 * 1024 * 1024 + 1)}],
    Array.from({length: 257}, (_, i) => ({path: `repo/${i}`})),
  ];
  for (const entries of malformed) {
    const root = await mkdtemp(join(dir, 'extract-'));
    await assert.rejects(extractGithubArchive(archive(entries), root, signal));
    assert.deepEqual(await readdir(root), []);
  }
  const root = join(dir, 'truncated'); await mkdir(root);
  await assert.rejects(extractGithubArchive(pluginArchive().subarray(0, 30), root, signal));
});

test('GitHub pax paths use byte lengths and cannot override size or escape the repository', async t => {
  const dir = await fixture(t), signal = new AbortController().signal;
  const pax = value => {
    let length = Buffer.byteLength(value) + 3;
    while (length !== Buffer.byteLength(`${length} ${value}\n`)) length = Buffer.byteLength(`${length} ${value}\n`);
    return `${length} ${value}\n`;
  };
  await extractGithubArchive(archive([{path: 'pax', type: 'x', data: pax('path=repo/插件.mjs')}, {path: 'repo/short', data: 'export {};'}]), dir, signal);
  assert.equal(await readFile(join(dir, '插件.mjs'), 'utf8'), 'export {};');
  for (const header of ['path=repo/../escape', 'size=999999']) await assert.rejects(extractGithubArchive(archive([{path: 'pax', type: 'x', data: pax(header)}, {path: 'repo/short'}]), dir, signal));
});

test('desktop snapshots and cancellation stay responsive while a download is blocked', async t => {
  const dir = await fixture(t), tempBefore = new Set(await readdir(tmpdir()));
  let downloadStarted = false, stopped = false;
  globalThis.fetch = async (url, {signal}) => {
    if (url.startsWith('https://api.github.com/')) return new Response(JSON.stringify([{sha: commit}]));
    downloadStarted = true;
    return new Promise((_, reject) => signal.addEventListener('abort', () => {stopped = true; reject(signal.reason);}, {once: true}));
  };
  const start = await handleDesktopRequest({action: 'plugin-install-start', source: 'github:owner/repo'});
  assert.equal(start.ok, true);
  for (let i = 0; i < 100 && !downloadStarted; i++) await delay(5);
  assert.equal(downloadStarted, true);
  const snapshot = await handleDesktopRequest({action: 'snapshot'}), id = snapshot.snapshot.pluginInstall.id;
  assert.equal(snapshot.snapshot.pluginInstall.phase, 'downloading');
  assert.equal((await handleDesktopRequest({action: 'plugin-install-start', source: 'github:owner/repo'})).ok, false);
  assert.equal((await handleDesktopRequest({action: 'plugin-install-cancel', id: 'wrong'})).ok, false);
  assert.equal((await handleDesktopRequest({action: 'plugin-install-cancel', id})).ok, true);
  assert.equal((await settled()).phase, 'cancelled'); assert.equal(stopped, true);
  assert.deepEqual(listPlugins(), []);
  assert.deepEqual((await readdir(tmpdir())).filter(p => p.startsWith('adp-plugin-') && !tempBefore.has(p)), []);
  const source = join(dir, 'local'); await mkdir(source);
  await writeFile(join(source, 'adp-plugin.json'), JSON.stringify({apiVersion: 1, id: 'local', name: 'Local', version: '1.0.0'}));
  assert.equal((await handleDesktopRequest({action: 'plugin-install-start', source})).ok, true);
  assert.equal((await settled()).phase, 'installed'); assert.equal(getPlugin('local').installed, true);
});

test('catalog lock prevents overlapping CLI and desktop writes and releases after failure', async t => {
  const dir = await fixture(t), source = join(dir, 'local'); await mkdir(source);
  await writeFile(join(source, 'adp-plugin.json'), JSON.stringify({apiVersion: 1, id: 'local', name: 'Local', version: '1.0.0'}));
  await mkdir(pluginStatePath() + '.lock');
  await assert.rejects(installPlugin(source), /Another plugin change/);
  assert.deepEqual(listPlugins(), []);
  await rm(pluginStatePath() + '.lock', {recursive: true});
  const controller = new AbortController(); controller.abort();
  await assert.rejects(installPlugin(source, {signal: controller.signal}));
  await installPlugin(source);
  await assert.rejects(installPlugin(source), /already installed/);
  await changePlugin('local', 'disable');
  assert.equal(getPlugin('local').enabled, false);
});

test('CLI installs a local plugin and prints the next host setup step', async t => {
  const dir = await fixture(t), source = join(dir, 'local'); await mkdir(source);
  await writeFile(join(source, 'adp-plugin.json'), JSON.stringify({apiVersion: 1, id: 'local', name: 'Local', version: '1.0.0', setup: {kind: 'manual', instructions: 'Load the Local extension.'}}));
  const child = spawn(process.execPath, ['dist/cli.js', 'plugin', 'install', source]);
  let out = '', err = ''; child.stdout.on('data', d => out += d); child.stderr.on('data', d => err += d);
  const code = await new Promise(resolve => child.on('close', resolve));
  assert.equal(code, 0, err); assert.match(out, /Installed local/); assert.match(out, /Load the Local extension/);
  assert.match(err, /Plugin: installed/); assert.equal(getPlugin('local').installed, true);
});

test('closing the desktop bridge cancels its download and waits for temporary-file cleanup', async t => {
  await fixture(t);
  const before = new Set(await readdir(tmpdir()));
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    globalThis.fetch = async (url, {signal}) => url.startsWith('https://api.github.com/')
      ? new Response(JSON.stringify([{sha: '${commit}'}]))
      : new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), {once:true}));
    await import('./dist/desktop-bridge.js');
  `]);
  t.after(() => {if (child.exitCode === null) child.kill('SIGKILL');});
  const lines = createInterface({input: child.stdout})[Symbol.asyncIterator]();
  const closed = new Promise(resolve => child.on('close', resolve));
  const command = async value => {
    child.stdin.write(JSON.stringify(value) + '\n');
    return JSON.parse((await lines.next()).value);
  };
  assert.equal((await command({action: 'plugin-install-start', source: 'github:owner/repo'})).ok, true);
  let state;
  for (let i = 0; i < 100; i++) {
    state = (await command({action: 'snapshot'})).snapshot.pluginInstall;
    if (state.phase === 'downloading') break;
    await delay(5);
  }
  assert.equal(state.phase, 'downloading'); child.stdin.end();
  assert.equal(await closed, 0);
  assert.deepEqual((await readdir(tmpdir())).filter(p => p.startsWith('adp-plugin-') && !before.has(p)), []);
  assert.deepEqual(listPlugins(), []);
});
