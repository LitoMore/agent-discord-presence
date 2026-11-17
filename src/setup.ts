import {createHash} from 'node:crypto';
import {lstat, readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {socketPath} from './client.js';
import {settingsPath, loadSettings, resolveSettings, saveSetting} from './settings.js';
import {hookConfig} from './adapters/hooks.js';
import {catalogFor, selectEvents, selectionWarnings, validateEvents, scenariosFor, scenarioSelection, validateSummaryTriggers,
  type EventSelection, type IntegrationEvent, type IntegrationScenario, type SummaryTrigger} from './integration-events.js';
import {entryContent, policyPath, quote} from './integration-config.js';
import {nodeCommand} from './node-runtime.js';
import {commitIntegrationFile, integrationPath, recognizedEntry, removeHooks} from './uninstall.js';
import type {Agent} from './protocol.js';

export interface SetupOptions extends EventSelection {path?: string; scenarios?: string[]; summaryTriggers?: SummaryTrigger[]}
export interface SetupPlan {
  agent: Agent; path: string; kind: 'hooks' | 'entry' | 'policy'; status: 'ready' | 'unchanged' | 'manual';
  selectedEvents: string[]; installedEvents: string[]; added: string[]; removed: string[]; kept: string[];
  catalog: IntegrationEvent[]; warnings: string[]; revision: string; note: string;
  scenarios: IntegrationScenario[]; summaryTriggers: SummaryTrigger[];
}
export interface SetupResult {plan: SetupPlan; changed: boolean; backup?: string}
export function hookCommand(): string {
  return `ADP_CONFIG=${quote(resolve(settingsPath()))} AGENT_PRESENCE_SOCKET=${quote(process.platform === 'win32' ? socketPath() : resolve(socketPath()))} ${nodeCommand(fileURLToPath(new URL('./cli.js', import.meta.url)))}`;
}
async function inspect(agent: Agent, options: SetupOptions) {
  const catalog = catalogFor(agent);
  if (options.scenarios !== undefined && (options.events !== undefined || options.profile !== undefined || options.summaryTriggers !== undefined)) throw new Error('Use scenarios or a custom event selection');
  const configuration = loadSettings();
  const effective = resolveSettings(configuration, agent);
  const scenario = options.scenarios === undefined ? undefined : scenarioSelection(agent, options.scenarios);
  const summaryTriggers = validateSummaryTriggers(scenario?.summaryTriggers ?? options.summaryTriggers ?? effective.summaryTriggers);
  const settingsChanged = JSON.stringify(summaryTriggers) !== JSON.stringify(effective.summaryTriggers);
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
  const selected = scenario?.events ?? (options.events !== undefined || options.profile !== undefined ? selectEvents(agent, options)
    : installed.length ? validateEvents(agent, installed) : selectEvents(agent));
  if (!selected.length) throw new Error('Select at least one event, or use uninstall to remove the integration.');
  const added = selected.filter(id => !installed.includes(id));
  const removed = installed.filter(id => !selected.includes(id));
  const kept = selected.filter(id => installed.includes(id));
  if (!manual) {
    if (kind === 'hooks') {
      const command = hookCommand();
      const config = JSON.parse((await removeHooks(before ?? '{}', agent, removed, `${command} hook ${agent}`)).after) as ReturnType<typeof hookConfig>;
      config.hooks ??= {};
      const generated = hookConfig(agent as 'codex' | 'claude-code', command, added);
      for (const [id, groups] of Object.entries(generated.hooks)) config.hooks[id] = [...(config.hooks[id] ?? []), ...groups];
      after = JSON.stringify(config, null, before?.match(/\n([\t ]+)"/)?.[1] ?? 2) + '\n';
    } else if (kind === 'entry') after = entryContent(agent as 'pi' | 'opencode', selected) + '\n';
    else after = JSON.stringify({events: selected}, null, 2) + '\n';
    if (!added.length && !removed.length && before !== undefined && (kind !== 'hooks' || JSON.stringify(JSON.parse(before)) === JSON.stringify(JSON.parse(after!)))) after = before;
  }
  const warnings = selectionWarnings(agent, selected);
  if (summaryTriggers.includes('tool') && !scenariosFor(agent).some(s => s.summaryTrigger === 'tool')) warnings.push('Tool-call summaries are not supported by this adapter.');
  for (const scenario of scenariosFor(agent)) {
    if (scenario.summaryTrigger && summaryTriggers.includes(scenario.summaryTrigger) && !scenario.events.every(id => selected.includes(id))) {
      warnings.push(`Summary scenario is missing events: ${scenario.events.filter(id => !selected.includes(id)).join(', ')}.`);
    }
  }
  const plan: SetupPlan = {agent, path, kind, status: manual ? 'manual' : before === after && !settingsChanged ? 'unchanged' : 'ready',
    selectedEvents: selected, installedEvents: installed, added, removed, kept, catalog, warnings, revision: '',
    scenarios: scenariosFor(agent), summaryTriggers,
    note: manual ? 'The existing integration contains unsupported content. Review it manually before applying changes.'
      : kind === 'policy' ? 'Harness options are saved separately. Install the plugin through Harness, then reload it to apply these options.'
      : 'Review the selected events. Other hooks and settings will be preserved.'};
  plan.revision = createHash('sha256').update(JSON.stringify([plan, before, after, mode, configuration])).digest('hex');
  return {plan, before, after, mode, settingsChanged};
}
export async function planSetup(agent: Agent, options: SetupOptions = {}): Promise<SetupPlan> { return (await inspect(agent, options)).plan; }
export async function applySetup(agent: Agent, options: SetupOptions, revision: string): Promise<SetupResult> {
  const {plan, before, after, mode, settingsChanged} = await inspect(agent, options);
  if (revision !== plan.revision) throw new Error('The integration changed. Preview the configuration again.');
  if (plan.status !== 'ready') return {plan, changed: false};
  const backup = before === after ? undefined : await commitIntegrationFile(plan.path, before, after, mode);
  if (settingsChanged) await saveSetting('summaryTriggers', plan.summaryTriggers, false, agent);
  return {plan, changed: true, backup};
}
