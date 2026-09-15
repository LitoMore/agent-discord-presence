import {createConnection} from 'node:net';
import {join} from 'node:path';
import {tmpdir, userInfo} from 'node:os';
import {createHash} from 'node:crypto';
import type {Agent, PresenceEvent, State} from './protocol.js';
import {parseSummary, type Summary} from './summary.js';
import {boundedResponse} from './completion.js';
let lastTimestamp = 0;
export function socketPath(): string {
  if (process.env.AGENT_PRESENCE_SOCKET) return process.env.AGENT_PRESENCE_SOCKET;
  const id = createHash('sha256').update(userInfo().username).digest('hex').slice(0, 12);
  return process.platform === 'win32' ? `\\\\.\\pipe\\agent-presence-${id}` : join(tmpdir(), `agent-presence-${id}`, 'service.sock');
}
export function request(message: object, path = socketPath(), timeout = 500): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    socket.setEncoding('utf8');
    let buffer = '';
    const timer = setTimeout(() => finish(new Error('Presence service timed out')), timeout);
    function finish(error?: Error, result?: unknown) {
      clearTimeout(timer); socket.destroy();
      if (error) reject(error); else resolve(result);
    }
    socket.on('error', error => finish(error));
    socket.on('connect', () => socket.write(JSON.stringify(message) + '\n'));
    socket.on('end', () => finish(new Error('Presence service disconnected')));
    socket.on('data', data => {
      buffer += data.toString();
      if (buffer.length > 256 * 1024) return finish(new Error('Response too large'));
      if (!buffer.includes('\n')) return;
      try {
        const result = JSON.parse(buffer.slice(0, buffer.indexOf('\n')));
        finish(result.ok ? undefined : new Error(result.error ?? 'Request failed'), result);
      } catch { finish(new Error('Invalid service response')); }
    });
  });
}
export async function emit(event: PresenceEvent, path?: string): Promise<void> {
  try { await request({type: 'event', event}, path); } catch { /* Presence never blocks the agent. */ }
}
export interface SummaryTarget {key: string; updatedAt: number; startedAt: number}
/** Capture the target before generating a summary so stale model output can be rejected. */
export async function summaryTarget(key: string): Promise<SummaryTarget> {
  const status = await request({type: 'status'}) as {sessions: SummaryTarget[]};
  const session = status.sessions.find(s => s.key === key);
  if (!session) throw new Error('Unknown session');
  return {key, updatedAt: session.updatedAt, startedAt: session.startedAt};
}
export async function publishSummary(target: SummaryTarget, summary: Summary | null): Promise<void> {
  await request({type: 'summary', key: target.key, summary: summary === null ? null : parseSummary(summary),
    expectedUpdatedAt: target.updatedAt, expectedStartedAt: target.startedAt});
}
/** A bounded, serialized queue coalesces rapid updates and preserves close ordering. */
export class Reporter {
  private event?: PresenceEvent;
  private pending?: PresenceEvent;
  private sending?: Promise<void>;
  private timer?: ReturnType<typeof setInterval>;
  model?: string;
  provider?: string;
  constructor(readonly agent: Agent, readonly sessionId: string,
    private readonly send: (event: PresenceEvent) => Promise<void> = emit) {}
  set(state: State, response?: string): void {
    const updatedAt = Math.max(Date.now(), lastTimestamp + 1);
    lastTimestamp = updatedAt;
    this.event = {version: 1, agent: this.agent, sessionId: this.sessionId, state, updatedAt, pid: process.pid, model: this.model, provider: this.provider};
    this.enqueue(response ? {...this.event, response: boundedResponse(response)} : this.event);
    if (!this.timer && state !== 'closed') {
      this.timer = setInterval(() => {
        if (this.event) this.enqueue({...this.event, heartbeat: true});
      }, 20_000);
      this.timer.unref();
    }
  }
  private enqueue(event: PresenceEvent): void {
    this.pending = event;
    if (this.sending) return;
    this.sending = this.flush().finally(() => { this.sending = undefined; });
  }
  private async flush(): Promise<void> {
    while (this.pending) {
      const next = this.pending; this.pending = undefined;
      try { await this.send(next); } catch { /* Best effort, including custom transports. */ }
    }
  }
  async close(): Promise<void> {
    clearInterval(this.timer); this.timer = undefined;
    this.set('closed');
    await this.sending;
  }
}
