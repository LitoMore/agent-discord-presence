import {Reporter} from '../client.js';
import {assistantText} from '../completion.js';
interface Context {sessionManager: {getSessionId(): string}; isIdle(): boolean; model?: {id: string; provider: string}}
interface ExtensionAPI {on(event: string, handler: (event: unknown, context: Context) => void | Promise<void>): void}
export default function presence(pi: ExtensionAPI): void {
  if (process.env.ADP_SUMMARY_WORKER === '1') return;
  let reporter: Reporter | undefined;
  let waiting = false;
  let response = '';
  pi.on('session_start', async (_event, ctx) => {
    await reporter?.close();
    reporter = new Reporter('pi', ctx.sessionManager.getSessionId());
    waiting = false; response = ''; reporter.set(ctx.isIdle() ? 'idle' : 'working');
  });
  pi.on('agent_start', () => { response = ''; reporter?.set(waiting ? 'waiting' : 'working'); });
  pi.on('message_end', event => {
    const text = assistantText((event as {message?: unknown})?.message);
    if (text) response = text;
  });
  // agent_end may be followed by retry, compaction, or queued continuation.
  pi.on('agent_settled', (_event, ctx) => {
    if (reporter) { reporter.model = ctx.model?.id; reporter.provider = ctx.model?.provider; }
    reporter?.set(waiting ? 'waiting' : 'idle', waiting ? undefined : response); response = '';
  });
  pi.on('ui_prompt_start', () => { waiting = true; reporter?.set('waiting'); });
  pi.on('ui_prompt_end', (_event, ctx) => { waiting = false; reporter?.set(ctx.isIdle() ? 'idle' : 'working'); });
  pi.on('session_shutdown', async () => { await reporter?.close(); reporter = undefined; waiting = false; });
}
