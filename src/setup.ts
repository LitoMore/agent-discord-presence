import {createHash} from 'node:crypto';
import {lstat, readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {socketPath} from './client.js';
import {settingsPath} from './settings.js';
import {hookConfig} from './adapters/hooks.js';
import {catalogFor, selectEvents, selectionWarnings, validateEvents, type EventSelection, type IntegrationEvent} from './integration-events.js';
import {entryContent, policyPath, quote} from './integration-config.js';
import {commitIntegrationFile, integrationPath, recognizedEntry, removeHooks} from './uninstall.js';
import type {Agent} from './protocol.js';

export interface SetupOptions extends EventSelection {path?: string}
export interface SetupPlan {
  agent: Agent; path: string; kind: 'hooks' | 'entry' | 'policy'; status: 'ready' | 'unchanged' | 'manual';
  selectedEvents: string[]; installedEvents: string[]; added: string[]; removed: string[]; kept: string[];
  catalog: IntegrationEvent[]; warnings: string[]; revision: string; note: string;
}
export interface SetupResult {plan: SetupPlan; changed: boolean; backup?: string}
export function hookCommand(): string {
  return `ADP_CONFIG=${quote(resolve(settingsPath()))} AGENT_PRESENCE_SOCKET=${quote(process.platform === 'win32' ? socketPath() : resolve(socketPath()))} ${quote(process.execPath)} ${quote(fileURLToPath(new URL('./cli.js', import.meta.url)))}`;
}
async function inspect(agent: Agent, options: SetupOptions) {
  const catalog = catalogFor(agent);
  if (options.path !== undefined && (typeof options.path !== 'string' || !options.path.trim() || options.path.includes('\0'))) throw new Error('Invalid integration path');
  const path = resolve(options.path ?? (agent === 'deepseek-harness' ? policyPath() : integrationPath(agent)));
  if (agent === 'deepseek-harness' && options.path !== undefined && path !== policyPath()) throw new Error('Harness options use the Presence policy file; choose the installation profile in Harness.');
  const kind = agent === 'codex' || agent === 'claude-code' ? 'hooks' : agent === 'deepseek-harness' ? 'policy' : 'entry';
  if (kind === 'hooks' && process.platform === 'win32') throw new Error('On Windows, use the bundled PATH-based hooks and configure events manually.');
  let before: string | undefined, after: string | undefined, mode = 0o600, manual = false;
  let installed: string[] = [];
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.size > 512 * 1024) manual = true;
    else { before = await readFile(path, 'utf8'); mode = info.mode & 0o777; }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  try {
    if (before !== undefined) {
      if (kind === 'hooks') {
        const patch = await removeHooks(before, agent, []);
        installed = patch.installedEvents; manual = patch.uncertain;
      } else if (kind === 'entry') {
        const entry = await recognizedEntry(before, agent as 'pi' | 'opencode');
        if (!entry) manual = true; else installed = entry.events;
      } else installed = validateEvents(agent, JSON.parse(before).events);
    }
  } catch { manual = true; }
  // Existing files are the source of truth. A copied prompt is never counted as installed.
  const selected = options.events !== undefined || options.profile !== undefined ? selectEvents(agent, options)
    : installed.length ? validateEvents(agent, installed) : selectEvents(agent);
  if (!selected.length) throw new Error('Select at least one event, or use uninstall to remove the integration.');
  const added = selected.filter(id => !installed.includes(id));
  const removed = installed.filter(id => !selected.includes(id));
  const kept = selected.filter(id => installed.includes(id));
  if (!manual) {
    if (kind === 'hooks') {
      const config = JSON.parse((await removeHooks(before ?? '{}', agent, removed)).after) as ReturnType<typeof hookConfig>;
      config.hooks ??= {};
      const generated = hookConfig(agent as 'codex' | 'claude-code', hookCommand(), added);
      for (const [id, groups] of Object.entries(generated.hooks)) config.hooks[id] = [...(config.hooks[id] ?? []), ...groups];
      after = JSON.stringify(config, null, before?.match(/\n([\t ]+)"/)?.[1] ?? 2) + '\n';
    } else if (kind === 'entry') after = entryContent(agent as 'pi' | 'opencode', selected) + '\n';
    else after = JSON.stringify({events: selected}, null, 2) + '\n';
    if (!added.length && !removed.length && before !== undefined) after = before;
  }
  const plan: SetupPlan = {agent, path, kind, status: manual ? 'manual' : before === after ? 'unchanged' : 'ready',
    selectedEvents: selected, installedEvents: installed, added, removed, kept, catalog, warnings: selectionWarnings(agent, selected), revision: '',
    note: manual ? 'The existing integration contains unsupported content. Review it manually before applying changes.'
      : kind === 'policy' ? 'Harness options are saved separately. Install the plugin through Harness, then reload it to apply these options.'
      : 'Review the selected events. Other hooks and settings will be preserved.'};
  plan.revision = createHash('sha256').update(JSON.stringify([plan, before, after, mode])).digest('hex');
  return {plan, before, after, mode};
}
export async function planSetup(agent: Agent, options: SetupOptions = {}): Promise<SetupPlan> { return (await inspect(agent, options)).plan; }
export async function applySetup(agent: Agent, options: SetupOptions, revision: string): Promise<SetupResult> {
  const {plan, before, after, mode} = await inspect(agent, options);
  if (revision !== plan.revision) throw new Error('The integration changed. Preview the configuration again.');
  if (plan.status !== 'ready') return {plan, changed: false};
  const backup = await commitIntegrationFile(plan.path, before, after, mode);
  return {plan, changed: true, backup};
}
