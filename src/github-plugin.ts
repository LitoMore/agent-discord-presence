import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {gunzip} from 'node:zlib';
import {promisify} from 'node:util';
import type {PluginSource} from './agent-plugins.js';

const limit = 10 * 1024 * 1024;
const unzip = promisify(gunzip);
export function parseGithubSource(spec: string): {owner: string; repo: string; ref?: string} {
  const match = /^github:([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9_.-]{1,100})(?:#([^\s#?\\\x00-\x1f]{1,255}))?$/.exec(spec);
  if (!match || ['.', '..'].includes(match[2]) || match[2].endsWith('.git')) throw new Error('Use github:OWNER/REPO or github:OWNER/REPO#REF');
  return {owner: match[1], repo: match[2], ref: match[3]};
}
async function download(url: string, signal: AbortSignal, progress?: (bytes: number, total?: number) => void): Promise<Buffer> {
  const response = await fetch(url, {signal, redirect: 'error', headers: {'User-Agent': 'agent-discord-presence', Accept: 'application/vnd.github+json'}}).catch(error => {
    if (signal.aborted) throw error;
    throw new Error('Unable to connect to GitHub. Check your network connection and try again.');
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(response.status === 404 || response.status === 422 ? 'GitHub repository or ref not found. Check the address and ref, and make sure the repository is public.'
      : response.status === 409 ? 'This GitHub repository has no commits. Choose a repository containing an ADP plugin.'
      : response.status === 403 || response.status === 429 ? 'GitHub rate limit or access restriction. Try again later.'
      : response.status >= 500 ? 'GitHub is temporarily unavailable. Try again later.' : `GitHub request failed (HTTP ${response.status})`);
  }
  const total = Number(response.headers.get('content-length')) || undefined;
  const chunks: Uint8Array[] = []; let bytes = 0;
  if (!response.body) throw new Error('GitHub returned an empty response');
  const reader = response.body.getReader();
  try {
    if (total && total > limit) throw new Error('GitHub response exceeds 10 MB');
    for (;;) {
      signal.throwIfAborted();
      const {done, value} = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) throw new Error('GitHub response exceeds 10 MB');
      chunks.push(value); progress?.(bytes, total);
    }
    return Buffer.concat(chunks);
  } finally {await reader.cancel().catch(() => {}); reader.releaseLock();}
}

/** GitHub snapshots contain regular files/directories and optional POSIX pax headers. */
export async function extractGithubArchive(compressed: Buffer, root: string, signal: AbortSignal): Promise<void> {
  const tar = await unzip(compressed, {maxOutputLength: limit});
  signal.throwIfAborted();
  const decoder = new TextDecoder('utf-8', {fatal: true});
  const text = (b: Buffer) => decoder.decode(b.subarray(0, b.indexOf(0) < 0 ? b.length : b.indexOf(0)));
  const octal = (b: Buffer) => {
    const value = text(b).trim();
    if (!/^[0-7]+$/.test(value)) throw new Error('Invalid archive header');
    return parseInt(value, 8);
  };
  const entries: {path: string; directory: boolean; data: Buffer}[] = [];
  const names = new Set<string>(); let prefix = '', paxPath: string | undefined, bytes = 0, ended = false;
  for (let offset = 0; offset + 512 <= tar.length;) {
    signal.throwIfAborted();
    const h = tar.subarray(offset, offset + 512); offset += 512;
    if (h.every(b => b === 0)) {
      if (tar.length - offset < 512 || !tar.subarray(offset).every(b => b === 0)) throw new Error('Invalid archive ending');
      ended = true; break;
    }
    let sum = 0; for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
    if (sum !== octal(h.subarray(148, 156))) throw new Error('Invalid archive checksum');
    const size = octal(h.subarray(124, 136)), end = offset + size;
    if (end > tar.length) throw new Error('Truncated archive');
    const data = tar.subarray(offset, end); offset += Math.ceil(size / 512) * 512;
    const type = String.fromCharCode(h[156]);
    if (type === 'x' || type === 'g') {
      for (let start = 0; start < data.length;) {
        const space = data.indexOf(32, start);
        const length = Number(data.subarray(start, space).toString('ascii'));
        if (space < start || !Number.isSafeInteger(length) || length <= space - start + 1 || start + length > data.length || data[start + length - 1] !== 10) throw new Error('Invalid pax header');
        const record = decoder.decode(data.subarray(space + 1, start + length - 1));
        const equal = record.indexOf('='), key = record.slice(0, equal), value = record.slice(equal + 1);
        if (equal < 1 || key === 'linkpath' || key === 'size' || (type === 'g' && key === 'path')) throw new Error('Unsupported pax header');
        if (key === 'path') paxPath = value;
        start += length;
      }
      continue;
    }
    if (!['0', '\0', '5'].includes(type)) throw new Error('Plugin archives cannot contain links or special files');
    let path = paxPath ?? [text(h.subarray(345, 500)), text(h.subarray(0, 100))].filter(Boolean).join('/');
    paxPath = undefined;
    path = path.replace(/\/$/, '');
    if (path.length > 4096) throw new Error('Archive path is too long');
    const parts = path.split('/');
    if (parts.some(p => !p || p === '.' || p === '..' || /[\\:\x00-\x1f\x7f]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) throw new Error('Unsafe archive path');
    prefix ||= parts[0];
    if (parts[0] !== prefix) throw new Error('Archive must have one repository root');
    const directory = type === '5';
    if (directory && size !== 0) throw new Error('Invalid archive directory');
    if (parts.length === 1) {if (!directory) throw new Error('Missing repository root'); continue;}
    path = parts.slice(1).join('/');
    if (names.has(path.toLowerCase())) throw new Error('Duplicate archive path');
    names.add(path.toLowerCase()); bytes += size;
    if (names.size > 256 || bytes > 8 * 1024 * 1024) throw new Error('Plugin package exceeds 256 entries or 8 MB');
    entries.push({path, directory, data});
  }
  if (!ended || paxPath !== undefined) throw new Error('Truncated archive');
  for (const entry of entries) {
    signal.throwIfAborted();
    const path = join(root, entry.path);
    if (entry.directory) await mkdir(path, {recursive: true});
    else {await mkdir(join(path, '..'), {recursive: true}); await writeFile(path, entry.data, {flag: 'wx', mode: 0o600});}
  }
}
export async function fetchGithubPlugin(spec: string, root: string, signal: AbortSignal,
  phase: (phase: 'resolving' | 'downloading' | 'validating', bytes?: number, total?: number) => void): Promise<PluginSource> {
  const {owner, repo, ref} = parseGithubSource(spec);
  phase('resolving');
  const query = new URLSearchParams({per_page: '1', ...ref ? {sha: ref} : {}});
  const commits = JSON.parse((await download(`https://api.github.com/repos/${owner}/${repo}/commits?${query}`, signal)).toString('utf8')) as {sha?: string}[];
  const commit = Array.isArray(commits) ? commits[0]?.sha : undefined;
  if (!commit || !/^[a-f0-9]{40}$/.test(commit)) throw new Error('GitHub did not return a commit');
  phase('downloading', 0);
  const archive = await download(`https://codeload.github.com/${owner}/${repo}/tar.gz/${commit}`, signal, (bytes, total) => phase('downloading', bytes, total));
  phase('validating');
  await extractGithubArchive(archive, root, signal);
  return {type: 'github', spec, commit};
}
