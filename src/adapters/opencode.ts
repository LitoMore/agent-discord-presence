import {Reporter} from '../client.js';
import {boundedResponse} from '../completion.js';
// The subset of OpenCode's plugin contract used here; no host runtime dependency.
interface Event {type: string; properties: Record<string, unknown>}
interface Host {directory: string}
interface Entry {reporter: Reporter; busy: boolean; permissions: Set<string>; messageId?: string; parts: Map<string, string>}
export const AgentPresence = async (_host: Host) => {
  if (process.env.ADP_SUMMARY_WORKER === '1') return {};
  const entries = new Map<string, Entry>();
  function get(id: string): Entry {
    let entry = entries.get(id);
    if (!entry) {
      entry = {reporter: new Reporter('opencode', id), busy: false, permissions: new Set(), parts: new Map()};
      entries.set(id, entry);
    }
    return entry;
  }
  return {
    event: async ({event}: {event: Event}) => {
      const p = event.properties;
      const info = p.info as {id?: string; parentID?: string; sessionID?: string; role?: string; modelID?: string; providerID?: string} | undefined;
      if (event.type === 'server.instance.disposed') {
        await Promise.all([...entries.values()].map(e => e.reporter.close())); entries.clear(); return;
      }
      const part = p.part as {sessionID?: string; messageID?: string; id?: string; type?: string; text?: string} | undefined;
      const id = typeof p.sessionID === 'string' ? p.sessionID : part?.sessionID ?? info?.sessionID ?? info?.id;
      if (!id) return;
      if (event.type === 'message.updated' && info) {
        const entry = get(id);
        if (info.role === 'user') { entry.parts.clear(); entry.messageId = undefined; }
        if (info.role === 'assistant') {
          if (entry.messageId !== info.id) entry.parts.clear();
          entry.messageId = info.id; entry.reporter.model = info.modelID; entry.reporter.provider = info.providerID;
        }
        return;
      }
      if (event.type === 'message.part.updated' && part?.type === 'text' && part.id) {
        const entry = entries.get(id);
        if (entry && entry.messageId === part.messageID && (entry.parts.has(part.id) || entry.parts.size < 32)) entry.parts.set(part.id, boundedResponse(part.text));
        return;
      }
      if (event.type === 'session.deleted') {
        await entries.get(id)?.reporter.close(); entries.delete(id); return;
      }
      if (!['session.created', 'session.status', 'session.idle', 'session.error', 'permission.asked', 'permission.replied'].includes(event.type)) return;
      const entry = get(id);
      if (event.type === 'session.created') entry.reporter.set('idle');
      if (event.type === 'session.status') {
        const status = (p.status as {type?: string} | undefined)?.type;
        if (!['busy', 'retry', 'idle'].includes(status ?? '')) return;
        entry.busy = status !== 'idle';
        if (!entry.busy) entry.permissions.clear();
        entry.reporter.set(entry.permissions.size ? 'waiting' : entry.busy ? 'working' : 'idle', entry.busy ? undefined : boundedResponse([...entry.parts.values()].join('\n')));
      }
      if (event.type === 'session.idle' || event.type === 'session.error') {
        entry.busy = false; entry.permissions.clear();
        entry.reporter.set(event.type === 'session.error' ? 'error' : 'idle', event.type === 'session.error' ? undefined : boundedResponse([...entry.parts.values()].join('\n')));
      }
      if (event.type === 'permission.asked') {
        entry.permissions.add(String(p.id)); entry.reporter.set('waiting');
      }
      if (event.type === 'permission.replied') {
        entry.permissions.delete(String(p.requestID));
        entry.reporter.set(entry.permissions.size ? 'waiting' : 'working');
      }
    },
  };
};
