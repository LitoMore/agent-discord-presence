export const agents = ['codex', 'claude-code', 'opencode', 'pi', 'deepseek-harness'] as const;
export type Agent = typeof agents[number];
export type State = 'idle' | 'working' | 'waiting' | 'error' | 'closed';
export interface PresenceEvent {
  version: 1;
  agent: Agent;
  sessionId: string;
  state: State;
  /** Time of the last state event; heartbeats retain this value. */
  updatedAt: number;
  /** Only extensions running in the agent process should supply this. */
  pid?: number;
  heartbeat?: boolean;
  /** Transient assistant text for summarization; parseEvent never retains it. */
  response?: string;
  model?: string;
  provider?: string;
}
export const labels: Record<Agent, string> = {
  codex: 'Codex', 'claude-code': 'Claude Code', opencode: 'OpenCode',
  pi: 'Pi', 'deepseek-harness': 'DeepSeek Harness',
};
export function parseEvent(value: unknown, now = Date.now()): PresenceEvent {
  if (!value || typeof value !== 'object') throw new Error('Expected event object');
  const e = value as Record<string, unknown>;
  if (e.version !== 1 || !agents.includes(e.agent as Agent)) throw new Error('Unsupported protocol or agent');
  if (typeof e.sessionId !== 'string' || !e.sessionId.length || e.sessionId.length > 256) throw new Error('Invalid sessionId');
  if (!['idle', 'working', 'waiting', 'error', 'closed'].includes(e.state as string)) throw new Error('Invalid state');
  if (typeof e.updatedAt !== 'number' || !Number.isSafeInteger(e.updatedAt) || e.updatedAt < 0 || e.updatedAt > now + 60_000) throw new Error('Invalid updatedAt');
  if (e.pid !== undefined && (!Number.isSafeInteger(e.pid) || (e.pid as number) <= 0)) throw new Error('Invalid pid');
  if (e.heartbeat !== undefined && typeof e.heartbeat !== 'boolean') throw new Error('Invalid heartbeat');
  for (const key of ['model', 'provider']) {
    if (e[key] !== undefined && (typeof e[key] !== 'string' || (e[key] as string).length > 256)) throw new Error(`Invalid ${key}`);
  }
  // Whitelist fields: never retain prompts, paths, or tool arguments.
  return {version: 1, agent: e.agent as Agent, sessionId: e.sessionId,
    state: e.state as State, updatedAt: e.updatedAt, pid: e.pid as number | undefined,
    heartbeat: e.heartbeat as boolean | undefined, model: e.model as string | undefined, provider: e.provider as string | undefined};
}
export function sessionKey(e: Pick<PresenceEvent, 'agent' | 'sessionId'>): string {
  return `${e.agent}:${e.sessionId}`;
}
