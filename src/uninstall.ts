import {createHash, randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {link, lstat, open, readFile, rename, stat, unlink, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {basename, dirname, isAbsolute, join, resolve, sep} from 'node:path';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {agents, type Agent} from './protocol.js';
import {catalogFor, selectEvents, selectionWarnings, validateEvents, type IntegrationEvent} from './integration-events.js';
import {entryContent, parseEntry, policyPath} from './integration-config.js';

export interface UninstallPlan {
  agent: Agent;
  path: string;
  status: 'ready' | 'not-found' | 'manual';
  kind: 'hooks' | 'entry' | 'managed';
  count: number;
  details: string[];
  revision: string;
  note: string;
  manualReview: boolean;
  installedEvents: string[];
  selectedEvents: string[];
  catalog: IntegrationEvent[];
  warnings: string[];
  partial: boolean;
}
export interface UninstallResult {plan: UninstallPlan; removed: boolean; backup?: string}

export function integrationPath(agent: Agent): string {
  switch (agent) {
    case 'codex': return join(homedir(), '.codex/hooks.json');
    case 'claude-code': return join(homedir(), '.claude/settings.json');
    case 'opencode': return join(homedir(), '.config/opencode/plugins/agent-presence.ts');
    case 'pi': return join(homedir(), '.pi/agent/extensions/agent-presence.ts');
    case 'deepseek-harness': return '';
    default: throw new Error('Unknown agent');
  }
}
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const cli = fileURLToPath(new URL('./cli.js', import.meta.url));
const referencesPresence = (text: string) => /agent-discord-presence|agent-presence|\badp\b|\bhook\s+(?:codex|claude-code)\b/.test(text) || text.includes(cli);

// Recognize only a simple invocation, never shell pipelines, expansions, or wrappers.
// This also decodes the POSIX quoting used by the configuration generator.
function commandWords(command: string): string[] | undefined {
  if (/[\r\n]/.test(command)) return;
  const words: string[] = [];
  let word = '', started = false, quote = '';
  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (quote) {
      if (char === quote) quote = '';
      else {
        if (quote === '"' && /[$`\\]/.test(char)) return;
        word += char;
      }
    } else if (char === "'" || char === '"') { quote = char; started = true; }
    else if (char === '\\' && command[i + 1] === "'") { word += "'"; i++; started = true; }
    else if (/\s/.test(char)) {
      if (started) { words.push(word); word = ''; started = false; }
    } else {
      if (/[;&|<>($`\\)]/.test(char)) return;
      word += char; started = true;
    }
  }
  if (quote) return;
  if (started) words.push(word);
  return words;
}
/** Identify other npm/checkouts/app bundles without executing their code. */
function installationFiles() {
  const cache = new Map<string, Promise<boolean>>();
  return (file: string, relative: string): Promise<boolean> => {
    const key = JSON.stringify([file, relative]);
    let result = cache.get(key);
    if (!result) {
      result = (async () => {
        if (file === fileURLToPath(new URL(`../${relative.replaceAll(sep, '/')}`, import.meta.url))) return true;
        if (!isAbsolute(file) || !file.endsWith(sep + relative)) return false;
        const root = file.slice(0, -relative.length);
        try {
          const manifestPath = join(root, 'package.json');
          const info = await stat(manifestPath);
          if (!info.isFile() || info.size > 64 * 1024 || !(await stat(file)).isFile()) return false;
          const manifest: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
          if (!isObject(manifest) || manifest.name !== 'agent-discord-presence' || !isObject(manifest.bin)) return false;
          const entry = manifest.bin['agent-discord-presence'];
          return typeof entry === 'string' && resolve(root, entry) === join(root, 'dist/cli.js');
        } catch { return false; }
      })();
      cache.set(key, result);
    }
    return result;
  };
}
type IdentifyFile = ReturnType<typeof installationFiles>;
async function ownedHook(value: unknown, agent: Agent, identify: IdentifyFile): Promise<boolean> {
  if (!isObject(value) || value.type !== 'command' || typeof value.command !== 'string') return false;
  const words = commandWords(value.command);
  if (!words) return false;
  if (words[0] === 'env' || words[0] === '/usr/bin/env') words.shift();
  // Setup prompts explicitly carry these two settings into agent hooks.
  while (/^(?:ADP_CONFIG|AGENT_PRESENCE_SOCKET)=/.test(words[0] ?? '')) words.shift();
  if (words.at(-2) !== 'hook' || words.at(-1) !== agent) return false;
  return (words.length === 3 && ['adp', 'agent-discord-presence'].includes(words[0])) ||
    (words.length === 4 && (words[0] === process.execPath || ['node', 'node.exe'].includes(basename(words[0]))) &&
      await identify(words[1], join('dist', 'cli.js')));
}
export async function removeHooks(source: string, agent: Agent, selected?: string[]): Promise<{after: string; details: string[]; uncertain: boolean; installedEvents: string[]; removedEvents: string[]}> {
  const config: unknown = JSON.parse(source);
  if (!isObject(config) || (config.hooks !== undefined && !isObject(config.hooks))) throw new Error('Invalid hooks configuration');
  const details: string[] = [];
  const identify = installationFiles();
  const installed = new Set<string>(), removed = new Set<string>();
  let uncertain = false;
  if (isObject(config.hooks)) {
    for (const [event, groups] of Object.entries(config.hooks)) {
      if (!Array.isArray(groups)) throw new Error('Invalid hooks configuration');
      const remaining: unknown[] = [];
      for (const group of groups) {
        if (!isObject(group) || !Array.isArray(group.hooks)) throw new Error('Invalid hooks configuration');
        const hooks: unknown[] = [];
        for (const hook of group.hooks) {
          if (await ownedHook(hook, agent, identify)) {
            installed.add(event);
            if (selected === undefined || selected.includes(event)) {
              removed.add(event); details.push(`${event}: ${(hook as {command: string}).command}`); continue;
            }
            hooks.push(hook); continue;
          }
          if (referencesPresence(JSON.stringify(hook))) uncertain = true;
          hooks.push(hook);
        }
        if (hooks.length === group.hooks.length) { remaining.push(group); continue; }
        // A matcher group with no hooks cannot execute anything. Retain every
        // group that still contains another hook, including all its metadata.
        if (hooks.length) remaining.push({...group, hooks});
      }
      config.hooks[event] = remaining;
      if (groups.length && !remaining.length) delete config.hooks[event];
    }
  }
  const indent = source.match(/\n([\t ]+)"/)?.[1] ?? '  ';
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  return {after: JSON.stringify(config, null, indent).replaceAll('\n', newline) + newline, details, uncertain,
    installedEvents: [...installed], removedEvents: [...removed]};
}
export async function recognizedEntry(source: string, agent: 'pi' | 'opencode'): Promise<ReturnType<typeof parseEntry>> {
  const entry = parseEntry(source, agent);
  if (!entry) return;
  const specifier = entry.source;
  if (specifier === `agent-discord-presence/${agent}`) return entry;
  try {
    const url = new URL(specifier);
    if (url.protocol !== 'file:' || url.search || url.hash) return;
    if (await installationFiles()(fileURLToPath(url), join('dist', 'adapters', `${agent}.js`))) return entry;
  } catch { /* Unrecognized code is preserved. */ }
}

async function inspect(agent: Agent, path?: string, events?: string[]) {
  if (!agents.includes(agent)) throw new Error('Unknown agent');
  if (events !== undefined) events = validateEvents(agent, events, false);
  if (path !== undefined && (typeof path !== 'string' || !path.trim() || path.includes('\0'))) throw new Error('Invalid integration path');
  const plan: UninstallPlan = {agent, path: path === undefined ? integrationPath(agent) : resolve(path),
    status: 'not-found', kind: agent === 'codex' || agent === 'claude-code' ? 'hooks' : 'entry', count: 0, details: [], revision: '',
    manualReview: false, installedEvents: [], selectedEvents: [], catalog: catalogFor(agent), warnings: [], partial: events !== undefined,
    note: 'No recognized integration was found at this path. Check project configuration and plugin-manager installations separately.'};
  let before: string | undefined, after: string | undefined, mode = 0o600;
  if (agent === 'deepseek-harness' && events === undefined) {
    plan.kind = 'managed'; plan.status = 'manual'; plan.path = '';
    try { plan.installedEvents = validateEvents(agent, JSON.parse(await readFile(policyPath(), 'utf8')).events); }
    catch { plan.installedEvents = selectEvents(agent); }
    plan.note = 'Remove Agent Discord Presence using the Harness plugin manager in the profile where it was installed, then restart Harness.';
  } else {
    if (agent === 'deepseek-harness') plan.path = policyPath();
    try {
      const info = await lstat(plan.path);
      if (!info.isFile() || info.isSymbolicLink()) {
        plan.status = 'manual'; plan.note = 'This path is not a regular file. Review it manually; nothing was changed.';
      } else if (info.size > 512 * 1024) {
        plan.status = 'manual'; plan.note = 'This file is too large to inspect automatically. Review it manually; nothing was changed.';
      } else {
        mode = info.mode & 0o777;
        before = await readFile(plan.path, 'utf8');
        if (plan.kind === 'hooks') {
          try {
            const patch = await removeHooks(before, agent, events);
            plan.installedEvents = patch.installedEvents;
            plan.selectedEvents = patch.removedEvents;
            plan.warnings = selectionWarnings(agent, patch.installedEvents.filter(id => !patch.removedEvents.includes(id)));
            if (patch.details.length) {
              after = patch.after; plan.details = patch.details; plan.status = 'ready';
              plan.manualReview = patch.uncertain;
              plan.note = patch.uncertain
                ? 'Additional possible Presence hooks could not be identified safely. Review them manually.'
                : 'Only recognized Presence hook commands will be removed.';
            } else if (patch.uncertain) {
              plan.status = 'manual'; plan.note = 'Possible Presence hooks could not be identified safely. Review them manually; nothing was changed.';
            }
          } catch {
            plan.status = 'manual'; plan.note = 'The hook configuration is invalid or unsupported. Review it manually; nothing was changed.';
          }
        } else {
          const entry = agent === 'deepseek-harness'
            ? {source: '', events: validateEvents(agent, JSON.parse(before).events)}
            : await recognizedEntry(before, agent as 'opencode' | 'pi');
          if (entry) {
            plan.installedEvents = entry.events;
            plan.selectedEvents = events === undefined ? entry.events : events.filter(id => entry.events.includes(id));
            if (events !== undefined) {
              const remaining = validateEvents(agent, entry.events.filter(id => !events.includes(id)));
              if (plan.selectedEvents.length) {
                after = agent === 'deepseek-harness' ? JSON.stringify({events: remaining}, null, 2) + '\n'
                  : entryContent(agent as 'opencode' | 'pi', remaining) + '\n';
                plan.details = plan.selectedEvents;
                plan.status = 'ready';
                plan.note = 'Selected plugin events will be disabled. Reload the agent to apply the change.';
                plan.warnings = selectionWarnings(agent, remaining);
              }
            } else {
              plan.status = 'ready'; plan.details = [before.trim()];
              plan.note = 'The Presence plugin or extension entry file will be removed.';
            }
          } else {
            plan.status = 'manual'; plan.note = 'This file contains custom or unrecognized code. Review it manually; nothing was changed.';
          }
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (agent === 'deepseek-harness' && events !== undefined) {
        const installed = selectEvents(agent);
        const remaining = validateEvents(agent, installed.filter(id => !events.includes(id)));
        plan.installedEvents = installed; plan.selectedEvents = events;
        if (events.length) {
          after = JSON.stringify({events: remaining}, null, 2) + '\n';
          plan.details = events; plan.status = 'ready';
          plan.note = 'Selected plugin events will be disabled. Reload the agent to apply the change.';
          plan.warnings = selectionWarnings(agent, remaining);
        }
      }
    }
  }
  plan.count = plan.details.length;
  if (plan.status === 'not-found' && plan.installedEvents.length && events !== undefined) plan.note = 'No selected events are installed. Other integration events were left unchanged.';
  plan.revision = createHash('sha256').update(JSON.stringify([plan, before, after, mode, events])).digest('hex');
  return {plan, before, after, mode};
}

export async function planUninstall(agent: Agent, path?: string, events?: string[]): Promise<UninstallPlan> {
  return (await inspect(agent, path, events)).plan;
}

export async function commitIntegrationFile(path: string, before: string | undefined, after: string | undefined, mode = 0o600): Promise<string | undefined> {
  const backup = before === undefined ? undefined : `${path}.adp-backup-${randomUUID()}.bak`;
  const temp = `${path}.adp-${randomUUID()}.tmp`;
  const unchanged = async () => {
    if (before === undefined) {
      try { await lstat(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
      throw new Error('The integration file changed. Preview the removal again.');
    }
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      if (!(await file.stat()).isFile() || await file.readFile('utf8') !== before) throw new Error('The integration file changed. Preview the removal again.');
    } finally { await file.close(); }
  };
  await unchanged();
  await mkdir(dirname(path), {recursive: true, mode: 0o700});
  if (backup) await writeFile(backup, before!, {flag: 'wx', mode: 0o600});
  try {
    if (after !== undefined) await writeFile(temp, after, {flag: 'wx', mode});
    await unchanged();
    if (after === undefined) await unlink(path);
    else if (before === undefined) {
      // Exclusive creation prevents a concurrently-created configuration from being replaced.
      await link(temp, path);
    } else await rename(temp, path);
  } finally {
    if (after !== undefined) await unlink(temp).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
  }
  return backup;
}

/** Re-inspect at commit time, so a desktop confirmation never applies a stale plan. */
export async function uninstallIntegration(agent: Agent, path?: string, revision?: string, events?: string[]): Promise<UninstallResult> {
  const {plan, before, after, mode} = await inspect(agent, path, events);
  if (revision !== undefined && revision !== plan.revision) throw new Error('The integration file changed. Preview the removal again.');
  if (plan.status !== 'ready') return {plan, removed: false};
  const backup = await commitIntegrationFile(plan.path, before, after, mode);
  return {plan, removed: true, backup};
}
