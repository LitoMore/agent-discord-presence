import {Reporter, request} from '../client.js';
import {assistantText} from '../completion.js';
import {harnessSummary, type HarnessLlm, type NativeSummaryJob} from '../native-summary.js';

// Structural subset of the Harness Cordis contract; no host runtime dependency.
interface Agent {id: string; status: 'idle' | 'running'; options: {model?: string; provider?: string}}
interface SessionEvent {type: string; data: {id?: string; message?: unknown; interrupted?: boolean; reason?: {kind: string}}; surfaceOp?: unknown}
interface Events {
  'agent/created': (payload: {agent: Agent}) => void;
  'agent/status': (payload: {agent: Agent; status: Agent['status']}) => void;
  'agent/error': (payload: {agent: Agent}) => void;
  'agent/disposed': (payload: {agent: Agent}) => Promise<void>;
  'session/event': (session: {id: string}, event: SessionEvent) => void;
}
interface Context {
  llm: HarnessLlm;
  on<K extends keyof Events>(name: K, handler: Events[K]): unknown;
  effect(callback: () => () => Promise<void>): unknown;
}
interface Entry {reporter: Reporter; busy: boolean; failed: boolean; response: string; approvals: Set<string>; epoch: number; controller?: AbortController}
export const name = 'agent-discord-presence';
export const inject = ['llm'];
export function apply(ctx: Context): void {
  if (process.env.ADP_SUMMARY_WORKER === '1') return;
  const entries = new Map<string, Entry>();
  const pending = new Map<Entry, {job: NativeSummaryJob; controller: AbortController}>();
  let running: Promise<void> | undefined;
  function cancel(entry: Entry): void {
    entry.epoch++; entry.controller?.abort(); pending.delete(entry);
  }
  async function drain(): Promise<void> {
    while (pending.size) {
      const [entry, {job, controller}] = pending.entries().next().value!; pending.delete(entry);
      const timer = setTimeout(() => controller.abort(), 60_000); timer.unref();
      try {
        controller.signal.throwIfAborted();
        if (!job.model || !job.provider) continue;
        const summary = await harnessSummary(ctx.llm, job, controller.signal);
        controller.signal.throwIfAborted();
        await request({type: 'native-summary', job: {...job, input: undefined}, summary});
      } catch { /* Auxiliary summaries must never interrupt Harness or log private model output. */ }
      finally { clearTimeout(timer); if (entry.controller === controller) entry.controller = undefined; }
    }
  }
  function get(agent: Agent): Entry {
    let entry = entries.get(agent.id);
    if (!entry) {
      const reporter = new Reporter('deepseek-harness', agent.id, async event => {
        const current = entries.get(agent.id); const epoch = current?.epoch;
        const result = await request({type: 'event', event, nativeSummary: true}) as {nativeSummary?: NativeSummaryJob};
        if (!result.nativeSummary || !current || entries.get(agent.id) !== current || current.epoch !== epoch || current.busy || current.failed) return;
        cancel(current);
        if (pending.size >= 32) return;
        const controller = new AbortController(); current.controller = controller;
        pending.set(current, {job: result.nativeSummary, controller});
        if (!running) running = drain().finally(() => { running = undefined; });
      });
      entry = {reporter, busy: agent.status === 'running', failed: false, response: '', approvals: new Set(), epoch: 0};
      entries.set(agent.id, entry);
      entry.reporter.model = agent.options.model;
      entry.reporter.provider = agent.options.provider;
    }
    return entry;
  }
  function publish(entry: Entry, completed = false): void {
    entry.reporter.set(entry.failed ? 'error' : entry.approvals.size ? 'waiting' : entry.busy ? 'working' : 'idle', completed && !entry.failed ? entry.response : undefined);
    if (completed) entry.response = '';
  }
  ctx.on('agent/created', ({agent}) => { publish(get(agent)); });
  ctx.on('agent/status', ({agent, status}) => {
    const entry = get(agent); entry.busy = status === 'running';
    if (entry.busy) { cancel(entry); entry.failed = false; entry.response = ''; }
    else entry.approvals.clear();
    publish(entry, !entry.busy);
  });
  ctx.on('agent/error', ({agent}) => {
    const entry = get(agent); cancel(entry); entry.failed = true; entry.response = ''; publish(entry);
  });
  ctx.on('session/event', (session, event) => {
    const entry = entries.get(session.id);
    if (!entry) return;
    if (event.type === 'turn/start') entry.response = '';
    if (event.type === 'assistant/message' && event.surfaceOp === 'append') {
      entry.response = event.data.interrupted ? '' : assistantText(event.data.message);
      const source = (event.data.message as {source?: {model?: string; provider?: string}} | undefined)?.source;
      entry.reporter.model = source?.model;
      entry.reporter.provider = source?.provider;
    }
    if (event.type === 'turn/end' && event.data.reason?.kind !== 'completed') entry.response = '';
    if (event.type === 'approval/asked' && event.data.id) { entry.approvals.add(event.data.id); publish(entry); }
    if (event.type === 'approval/decided' && event.data.id) { entry.approvals.delete(event.data.id); publish(entry); }
  });
  ctx.on('agent/disposed', async ({agent}) => {
    const entry = entries.get(agent.id); entries.delete(agent.id);
    if (entry) { cancel(entry); await entry.reporter.close(); }
  });
  ctx.effect(() => async () => {
    const closing = [...entries.values()]; entries.clear();
    for (const entry of closing) cancel(entry);
    await Promise.all(closing.map(entry => entry.reporter.close()));
    await running;
  });
}
