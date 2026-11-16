import {createInterface} from 'node:readline/promises';
import {stdin, stdout} from 'node:process';
import {agents, labels, type Agent} from './protocol.js';
import {catalogFor, relatedEvents, selectEvents, scenariosFor, validateSummaryTriggers} from './integration-events.js';
import {applySetup, planSetup, type SetupOptions} from './setup.js';
import {planUninstall, uninstallIntegration} from './uninstall.js';

export interface ManageFlags {path?: string; profile?: string; events?: string; scenarios?: string; 'summary-triggers'?: string; 'dry-run'?: boolean; interactive?: boolean}
export function eventFlags(flags: ManageFlags): SetupOptions {
  if (flags.events !== undefined && !flags.events.trim()) throw new Error('--events requires a comma-separated list');
  return {profile: flags.profile as SetupOptions['profile'], events: flags.events?.split(',').map(id => id.trim()),
    scenarios: flags.scenarios?.split(',').map(id => id.trim()),
    summaryTriggers: flags['summary-triggers'] === undefined ? undefined : validateSummaryTriggers(flags['summary-triggers'] ? flags['summary-triggers'].split(',').map(id => id.trim()) : [])};
}
export async function runManagement(command: 'setup' | 'uninstall', argument: string | undefined, flags: ManageFlags): Promise<void> {
  let agent = argument as Agent;
  const options: SetupOptions = {...eventFlags(flags), path: flags.path};
  const interactive = flags.interactive || !argument || (command === 'setup' && flags.profile === undefined && flags.events === undefined && flags.scenarios === undefined && flags['summary-triggers'] === undefined && !flags['dry-run']);
  let terminal: ReturnType<typeof createInterface> | undefined;
  try {
    if (interactive) {
      if (!stdin.isTTY || !stdout.isTTY) throw new Error('Interactive setup requires a terminal. Specify an agent with --profile or --events; use --dry-run to preview.');
      terminal = createInterface({input: stdin, output: stdout});
      if (!argument) {
        agents.forEach((id, index) => console.log(`${index + 1}. ${labels[id]}`));
        const answer = (await terminal.question('Choose agent: ')).trim();
        agent = agents[Number(answer) - 1] ?? answer as Agent;
      }
    }
    catalogFor(agent);
    if (interactive && terminal) {
      if (command === 'setup' && flags.profile === undefined && flags.events === undefined && flags.scenarios === undefined) {
        const catalog = scenariosFor(agent);
        catalog.forEach((s, index) => console.log(`${index + 1}. ${s.label} — ${s.description}`));
        const answer = (await terminal.question('Scenarios (numbers or names), comma-separated; Enter keeps the current configuration; advanced edits individual events: ')).trim();
        if (answer === 'advanced') options.profile = 'custom';
        else if (answer) options.scenarios = answer.split(',').map(value => catalog[Number(value.trim()) - 1]?.id ?? value.trim());
      }
      if ((command === 'setup' && options.profile === 'custom') || (command === 'uninstall' && flags.events === undefined)) {
        const installed = command === 'uninstall' ? (await planUninstall(agent, flags.path)).installedEvents : selectEvents(agent);
        const catalog = catalogFor(agent).filter(e => installed.includes(e.id));
        catalog.forEach((e, i) => console.log(`${i + 1}. ${e.id}${e.required ? ' [required]' : ''} — ${e.description}`));
        const answer = (await terminal.question(command === 'setup' ? 'Event numbers or names, comma-separated (required plugin events are retained): ' : 'Events to remove (numbers or names), or all for the whole integration: ')).trim();
        if (command === 'uninstall' && answer === 'all') options.events = undefined;
        else {
          if (!answer) { console.log('Cancelled.'); return; }
          const selected = answer.split(',').map(value => { const key = value.trim(); return catalog[Number(key) - 1]?.id ?? key; });
          options.events = command === 'setup' ? relatedEvents(agent, [...new Set([...selected, ...catalog.filter(e => e.required).map(e => e.id)])]) : relatedEvents(agent, selected, true);
        }
      }
    }
    if (command === 'setup') {
      const plan = await planSetup(agent, options);
      console.log(`File: ${plan.path}\nDetected: ${plan.installedEvents.join(', ') || '(none)'}\nAdd: ${plan.added.join(', ') || '(none)'}\nKeep: ${plan.kept.join(', ') || '(none)'}\nRemove: ${plan.removed.join(', ') || '(none)'}`);
      console.log(`Summary updates: ${plan.summaryTriggers.join(', ') || '(off)'}`);
      for (const warning of plan.warnings) console.log(`Note: ${warning}`);
      console.log(plan.note);
      if (plan.status === 'manual') { process.exitCode = 1; return; }
      if (flags['dry-run']) return;
      if (plan.status === 'unchanged') { console.log('Already configured.'); return; }
      if (terminal && (await terminal.question('Apply these changes? [y/N]: ')).trim().toLowerCase() !== 'y') { console.log('Cancelled.'); return; }
      const result = await applySetup(agent, {path: options.path, events: plan.selectedEvents, summaryTriggers: plan.summaryTriggers}, plan.revision);
      console.log(result.changed ? 'Configuration applied. Reload the agent / start a new session.' : 'No changes.');
      if (result.backup) console.log(`Backup: ${result.backup}`);
    } else {
      const plan = await planUninstall(agent, options.path, options.events);
      if (plan.path) console.log(`File: ${plan.path}`);
      for (const detail of plan.details) console.log(`  ${detail}`);
      for (const warning of plan.warnings) console.log(`Note: ${warning}`);
      console.log(plan.note);
      if (plan.status === 'manual') { process.exitCode = 1; return; }
      if (plan.status !== 'ready') return;
      if (flags['dry-run']) { console.log(`Would remove ${plan.count} Presence ${plan.kind === 'hooks' ? 'hook command(s)' : options.events ? 'event(s)' : 'entry file'}.`); return; }
      if (terminal && (await terminal.question('Remove these items? [y/N]: ')).trim().toLowerCase() !== 'y') { console.log('Cancelled.'); return; }
      const result = await uninstallIntegration(agent, options.path, plan.revision, options.events);
      if (result.removed) console.log(`Removed ${plan.count} Presence ${plan.kind === 'hooks' ? 'hook command(s)' : options.events ? 'event(s)' : 'entry file'}. Reload the agent / start a new session. Existing activity may remain until the session ends or expires.`);
      if (result.backup) console.log(`Backup: ${result.backup}`);
    }
  } finally { terminal?.close(); }
}
