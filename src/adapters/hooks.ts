import {emit} from '../client.js';
import type {Agent, PresenceEvent, State} from '../protocol.js';
import {boundedResponse} from '../completion.js';
export const hookEvents = {
  codex: ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Stop', 'Interrupt', 'SessionEnd'],
  'claude-code': ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'Notification', 'Stop', 'StopFailure', 'SessionEnd'],
} as const;
export type HookAgent = keyof typeof hookEvents;
export function hookEvent(agent: HookAgent, payload: Record<string, unknown>, now = Date.now()): PresenceEvent | undefined {
  if (typeof payload.session_id !== 'string' || !payload.session_id) return;
  const name = payload.hook_event_name;
  let state: State | undefined;
  if (name === 'SessionStart') {
    // Compaction is a continuation; it must not reset a busy session to idle.
    state = payload.source === 'compact' ? 'working' : 'idle';
  }
  if (['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure'].includes(name as string)) state = 'working';
  if (name === 'PermissionRequest') state = 'waiting';
  if (name === 'Notification' && ['permission_prompt', 'idle_prompt', 'elicitation_dialog'].includes(payload.notification_type as string)) state = 'waiting';
  if (name === 'Stop' || name === 'Interrupt') state = 'idle';
  if (name === 'StopFailure') state = 'error';
  if (name === 'SessionEnd') state = 'closed';
  if (!state) return;
  return {version: 1, agent: agent as Agent, sessionId: payload.session_id, state, updatedAt: now,
    ...(typeof payload.model === 'string' ? {model: payload.model} : {}),
    ...(name === 'Stop' ? {response: boundedResponse(payload.last_assistant_message)} : {})};
}
export async function runHook(agent: HookAgent): Promise<void> {
  if (process.env.ADP_SUMMARY_WORKER === '1') return;
  // Stamp before reading stdin; transport arrival order need not match hook order.
  const now = Date.now();
  const timer = setTimeout(() => process.stdin.destroy(), 750); timer.unref();
  try {
    let data = '';
    for await (const chunk of process.stdin) {
      data += chunk.toString();
      if (Buffer.byteLength(data) > 1024 * 1024) return;
    }
    const event = hookEvent(agent, JSON.parse(data), now);
    if (event) await emit(event);
  } catch { /* Hooks are advisory and must emit no model context. */ }
  finally { clearTimeout(timer); process.stdin.destroy(); }
}
export function hookConfig(agent: HookAgent, command = 'agent-discord-presence'): object {
  return {hooks: Object.fromEntries(hookEvents[agent].map(name => [name, [{hooks: [{
    type: 'command', command: `${command} hook ${agent}`, timeout: 2,
  }]}]]))};
}
