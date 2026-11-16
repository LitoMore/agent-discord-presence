import {agents, type Agent} from './protocol.js';

export type Capability = 'presence' | 'waiting' | 'tools' | 'errors' | 'summary' | 'cleanup';
export interface IntegrationEvent {
  id: string; capability: Capability; description: string; required: boolean; requires: string[]; source?: string;
}
const event = (id: string, capability: Capability, description: string, required = false, requires: string[] = [], source?: string): IntegrationEvent =>
  ({id, capability, description, required, requires, ...(source ? {source} : {})});
export const hookEvents = {
  codex: ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Stop', 'Interrupt', 'SessionEnd'],
  'claude-code': ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'Notification', 'Stop', 'StopFailure', 'SessionEnd'],
} as const;
const hookDescriptions: Record<string, [Capability, string]> = {
  SessionStart: ['presence', 'Initialize session activity.'], UserPromptSubmit: ['presence', 'Show working when a new prompt starts.'],
  PreToolUse: ['tools', 'Show working before a tool runs.'], PostToolUse: ['tools', 'Resume working after a tool finishes.'],
  PostToolUseFailure: ['tools', 'Resume activity after a tool failure.'], PermissionRequest: ['waiting', 'Show waiting for permission.'],
  Notification: ['waiting', 'Show waiting for supported input and permission notifications.'],
  Stop: ['presence', 'Show idle after a reply and provide completed text for automatic summaries.'],
  Interrupt: ['presence', 'Show idle after interruption.'], StopFailure: ['errors', 'Show an error when a reply fails.'],
  SessionEnd: ['cleanup', 'Clear the session immediately when it ends.'],
};
const hooks = (agent: keyof typeof hookEvents) => hookEvents[agent].map(id => event(id, ...hookDescriptions[id]));
export const eventCatalog: Record<Agent, IntegrationEvent[]> = {
  codex: hooks('codex'), 'claude-code': hooks('claude-code'),
  opencode: [
    event('session.created', 'presence', 'Initialize session activity.'),
    event('session.status', 'presence', 'Track working, retrying, and idle sessions.', true),
    event('session.idle', 'presence', 'Publish the final idle state.', true),
    event('session.error', 'errors', 'Show session errors.'),
    event('permission.asked', 'waiting', 'Show waiting for permission.', false, ['permission.replied']),
    event('permission.replied', 'waiting', 'Resume activity after permission is decided.', false, ['permission.asked']),
    event('message.updated', 'summary', 'Track the reply model and message boundary.', false, ['message.part.updated']),
    event('message.part.updated', 'summary', 'Collect completed reply text for automatic summaries.', false, ['message.updated']),
    event('session.deleted', 'cleanup', 'Release the session and heartbeat timer.', true),
    event('server.instance.disposed', 'cleanup', 'Release all reporters when the plugin unloads.', true),
  ],
  pi: [
    event('session_start', 'presence', 'Initialize the reporter for the current session.', true),
    event('agent_start', 'presence', 'Show working at the start of a run.', true),
    event('agent_settled', 'presence', 'Show idle only after retries and continuations finish.', true),
    event('ui_prompt_start', 'waiting', 'Show waiting for an interactive prompt.', false, ['ui_prompt_end']),
    event('ui_prompt_end', 'waiting', 'Restore activity after an interactive prompt.', false, ['ui_prompt_start']),
    event('message_end', 'summary', 'Collect completed assistant text for automatic summaries.'),
    event('session_shutdown', 'cleanup', 'Release the session and heartbeat timer.', true),
  ],
  'deepseek-harness': [
    event('agent/created', 'presence', 'Initialize agent activity.', true),
    event('agent/status', 'presence', 'Track working and final idle states.', true),
    event('agent/error', 'errors', 'Show errors and cancel obsolete summary work.'),
    event('turn/start', 'summary', 'Reset text at the start of a turn.', false, ['assistant/message', 'turn/end'], 'session/event'),
    event('assistant/message', 'summary', 'Collect completed assistant text and model metadata.', false, ['turn/start', 'turn/end'], 'session/event'),
    event('turn/end', 'summary', 'Discard incomplete or interrupted replies.', false, ['turn/start', 'assistant/message'], 'session/event'),
    event('approval/asked', 'waiting', 'Show waiting for approval.', false, ['approval/decided'], 'session/event'),
    event('approval/decided', 'waiting', 'Restore activity after approval.', false, ['approval/asked'], 'session/event'),
    event('agent/disposed', 'cleanup', 'Cancel jobs and release the session.', true),
    event('plugin/unload', 'cleanup', 'Release all reporters and summary jobs.', true, [], 'ctx.effect'),
  ],
};
export interface EventSelection {profile?: 'recommended' | 'lightweight' | 'custom'; events?: string[]}
export function catalogFor(agent: Agent): IntegrationEvent[] {
  if (!agents.includes(agent)) throw new Error('Unknown agent');
  return eventCatalog[agent];
}
export function validateEvents(agent: Agent, value: unknown, dependencies = true): string[] {
  const catalog = catalogFor(agent);
  if (!Array.isArray(value) || value.some(id => typeof id !== 'string' || !catalog.some(e => e.id === id))) throw new Error(`Unsupported events for ${agent}. Use adp events ${agent}.`);
  const selected = new Set(value as string[]);
  if (dependencies) {
    for (const e of catalog) {
      if (e.required && !selected.has(e.id)) throw new Error(`Required event: ${e.id}`);
      if (selected.has(e.id)) for (const dependency of e.requires) if (!selected.has(dependency)) throw new Error(`${e.id} requires ${dependency}`);
    }
  }
  return catalog.filter(e => selected.has(e.id)).map(e => e.id);
}
export function selectEvents(agent: Agent, options: EventSelection = {}): string[] {
  if (options.profile !== undefined && !['recommended', 'lightweight', 'custom'].includes(options.profile)) throw new Error('Choose recommended, lightweight, or custom');
  if (options.events !== undefined && options.profile !== undefined && options.profile !== 'custom') throw new Error('Use either --profile or --events');
  if (options.events !== undefined) return validateEvents(agent, options.events);
  if (options.profile === 'custom') throw new Error('Custom configuration requires events');
  return catalogFor(agent).filter(e => options.profile !== 'lightweight' || e.required || !['tools', 'waiting', 'summary'].includes(e.capability)).map(e => e.id);
}
export function selectionWarnings(agent: Agent, selected: string[]): string[] {
  const warnings: string[] = [];
  if (!selected.length) return warnings;
  const has = (id: string) => selected.includes(id);
  if (agent === 'codex' || agent === 'claude-code') {
    if (!has('SessionEnd')) warnings.push('Without SessionEnd, activity may remain until the session expires.');
    if (!has('UserPromptSubmit')) warnings.push('Without UserPromptSubmit, new prompts may not switch activity to working.');
    if (!has('Stop')) warnings.push('Without Stop, completed replies cannot update idle activity or automatic summaries.');
    if ((has('PermissionRequest') || has('Notification')) && !has('PreToolUse') && !has('PostToolUse')) warnings.push('Without tool hooks, waiting activity may persist until another lifecycle event.');
  } else if (!catalogFor(agent).some(e => e.capability === 'summary' && has(e.id))) {
    warnings.push('Reply collection is disabled. Automatic summaries will not receive new reply text.');
  }
  return warnings;
}
export function relatedEvents(agent: Agent, selected: string[], removing = false): string[] {
  const catalog = catalogFor(agent), result = new Set(selected);
  for (let pass = 0; pass < catalog.length; pass++) for (const event of catalog) {
    if (!removing && result.has(event.id)) for (const dependency of event.requires) result.add(dependency);
    if (removing && event.requires.some(id => result.has(id))) result.add(event.id);
  }
  return validateEvents(agent, [...result], !removing);
}
