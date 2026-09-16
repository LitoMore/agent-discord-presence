import {createServer, type Socket} from 'node:net';
import {mkdir, chmod, lstat, unlink} from 'node:fs/promises';
import {dirname} from 'node:path';
import {socketPath, request} from './client.js';
import {SessionStore} from './store.js';
import {DiscordClient, activityFor, type Activity} from './discord.js';
import {sessionKey} from './protocol.js';
import {DISCORD_CLIENT_ID} from './constants.js';
import {SummaryGeneration, generateSummary, type Generate} from './generation.js';
import {loadSettings, resolveSettings} from './settings.js';
import {buildPresencePrompt} from './prompts.js';
import {boundedResponse} from './completion.js';
import {nativeSummarySettings, type NativeSummaryJob} from './native-summary.js';
export interface Transport {status: string; readonly acknowledged?: boolean; start(): void; setActivity(activity: Activity | null): void; stop(): void}
export async function startDaemon(options: {clientId?: string; dryRun?: boolean; path?: string; staleMs?: number;
  transport?: Transport; log?: (message: string) => void; generate?: Generate; generationTimeoutMs?: number} = {}) {
  const path = options.path ?? socketPath();
  const log = options.log ?? console.log;
  const clientId = options.clientId ?? DISCORD_CLIENT_ID;
  if (!options.dryRun && !options.transport && !/^\d{17,20}$/.test(clientId)) throw new Error('Invalid Discord Application ID');
  if (process.platform !== 'win32') {
    await mkdir(dirname(path), {recursive: true, mode: 0o700});
    try {
      const info = await lstat(path);
      if (!info.isSocket() || info.uid !== process.getuid?.()) throw new Error('Refusing to replace an unowned or non-socket path');
      try { await request({type: 'status'}, path); throw new Error('Presence service is already running'); }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ECONNREFUSED' && code !== 'ENOENT') throw error;
      }
      await unlink(path);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  let settings = loadSettings();
  let settingsError: string | null = null;
  function reloadSettings() {
    try {
      const next = loadSettings();
      for (const session of store.sessions.values()) {
        const {presence: _beforePresence, ...before} = resolveSettings(settings, session.agent);
        const {presence: _afterPresence, ...after} = resolveSettings(next, session.agent);
        if (JSON.stringify(before) !== JSON.stringify(after)) session.generationRevision++;
      }
      settings = next; settingsError = null;
    }
    catch { settingsError = 'Invalid settings file; keeping the last valid configuration'; }
  }
  const store = new SessionStore(options.staleMs);
  let lastDry: string | undefined;
  const transport: Transport = options.transport ?? (options.dryRun ? {
    status: 'dry-run', start() {}, stop() {}, setActivity(activity) {
      const value = JSON.stringify(activity); if (lastDry !== value) { lastDry = value; log(value); }
    },
  } : new DiscordClient(clientId, undefined, undefined, log));
  const sockets = new Set<Socket>();
  const generation = new SummaryGeneration(store, options.generate ?? (async (agent, response, signal, context) => {
    const settings = resolveSettings(loadSettings(), agent);
    if (!settings.enabled) throw new Error('Summary generation disabled');
    return generateSummary(settings, agent, response, signal, context);
  }), () => transport.setActivity(currentActivity()), options.generationTimeoutMs);
  function currentActivity() {
    const session = store.select();
    return activityFor(session, resolveSettings(settings, session?.agent).presence);
  }
  function refresh() { reloadSettings(); store.sweep(); generation.reconcile(); transport.setActivity(currentActivity()); }
  const server = createServer(socket => {
    socket.setEncoding('utf8');
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {}); socket.setTimeout(2000, () => socket.destroy());
    let buffer = ''; let handled = false;
    socket.on('data', data => {
      if (handled) return;
      buffer += data.toString();
      if (Buffer.byteLength(buffer) > 32768) { socket.destroy(); return; }
      const end = buffer.indexOf('\n'); if (end < 0) return;
      handled = true;
      try {
        const message = JSON.parse(buffer.slice(0, end));
        if (closing) throw new Error('Presence service is stopping');
        if (message.type === 'stop') {
          socket.setTimeout(0);
          void close(socket);
          return;
        }
        store.sweep();
        if (message.type === 'native-summary') {
          reloadSettings();
          const job = message.job as NativeSummaryJob;
          const session = store.sessions.get(job.key);
          const effective = resolveSettings(settings, session?.agent);
          if (!effective.enabled || effective.service !== 'session' || nativeSummarySettings(effective) !== job.settings ||
              !session || session.agent !== 'deepseek-harness' || session.state !== 'idle' || session.generationRevision !== job.revision) throw new Error('Native summary is stale');
          store.setSummary(job.key, message.summary, job.updatedAt, job.startedAt);
        }
        else if (message.type === 'event') store.update(message.event);
        else if (message.type === 'summary') store.setSummary(message.key, message.summary, message.expectedUpdatedAt, message.expectedStartedAt);
        else if (message.type === 'pin') store.pin(message.key);
        else if (message.type !== 'status') throw new Error('Unknown request type');
        refresh();
        let nativeSummary: NativeSummaryJob | undefined;
        if (message.type === 'event' && message.event.response) {
          const key = sessionKey(message.event);
          const session = store.sessions.get(key);
          const effective = resolveSettings(settings, session?.agent);
          if (session && session.updatedAt === message.event.updatedAt && (options.generate || (!options.dryRun && effective.enabled))) {
            if (message.nativeSummary === true && session.agent === 'deepseek-harness' && effective.service === 'session' && !options.generate) {
              if (session.state === 'idle' && !message.event.heartbeat && effective.enabled) nativeSummary = {
                key, updatedAt: session.updatedAt, startedAt: session.startedAt, revision: session.generationRevision,
                model: effective.model || session.model || '', provider: effective.provider || session.provider || '',
                settings: nativeSummarySettings(effective),
                input: buildPresencePrompt({agent: session.agent, response: boundedResponse(message.event.response)}, effective),
              };
            } else generation.submit(key, message.event.response);
          }
        }
        socket.end(JSON.stringify(message.type === 'status' ? {
          ok: true, discord: transport.status, activityAcknowledged: transport.acknowledged ?? null, pinned: store.pinned,
          pid: process.pid, activity: currentActivity(), selected: store.select() ? sessionKey(store.select()!) : null,
          settingsError, presence: resolveSettings(settings, store.select()?.agent).presence,
          agentSettings: Object.fromEntries([...new Set([...store.sessions.values()].map(s => s.agent))].map(agent => [agent, resolveSettings(settings, agent)])),
          generation: {...generation.status, ...settings, modelPolicy: 'override-or-session'},
          sessions: [...store.sessions.values()].map(s => ({key: sessionKey(s), state: s.state, model: s.model, provider: s.provider, startedAt: s.startedAt, updatedAt: s.updatedAt, lastSeen: s.lastSeen, summary: s.summary})),
        } : {ok: true, nativeSummary}) + '\n');
      } catch (error) { socket.end(JSON.stringify({ok: false, error: (error as Error).message}) + '\n'); }
    });
  });
  server.maxConnections = 64;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject); server.listen(path, () => { server.removeListener('error', reject); resolve(); });
  });
  if (process.platform !== 'win32') await chmod(path, 0o600);
  server.on('error', error => log(`Presence service: ${error.message}`));
  transport.start(); refresh();
  const ticker = setInterval(refresh, 1000);
  let closing: Promise<void> | undefined;
  function close(reply?: Socket): Promise<void> {
    return closing ??= (async () => {
      clearInterval(ticker); transport.stop();
      const closed = new Promise<void>(resolve => server.close(() => resolve()));
      await generation.close();
      for (const socket of sockets) if (socket !== reply) socket.destroy();
      reply?.end(JSON.stringify({ok: true}) + '\n', () => reply.destroy());
      await closed;
    })();
  }
  return {path, store, close: () => close()};
}
