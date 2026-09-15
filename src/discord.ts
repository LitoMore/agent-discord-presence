import {createConnection, type Socket} from 'node:net';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Activity} from './presentation.js';
export {activityFor, type Activity} from './presentation.js';
export function frame(op: number, body: unknown): Buffer {
  const data = Buffer.from(JSON.stringify(body));
  const header = Buffer.alloc(8); header.writeUInt32LE(op); header.writeUInt32LE(data.length, 4);
  return Buffer.concat([header, data]);
}
export class Decoder {
  private buffer = Buffer.alloc(0);
  feed(data: Buffer): Array<{op: number; body: Record<string, unknown>}> {
    this.buffer = Buffer.concat([this.buffer, data]);
    const result = [];
    while (this.buffer.length >= 8) {
      const length = this.buffer.readUInt32LE(4);
      if (length > 1024 * 1024) throw new Error('Discord frame too large');
      if (this.buffer.length < length + 8) break;
      const op = this.buffer.readUInt32LE(0);
      const body = JSON.parse(this.buffer.subarray(8, length + 8).toString());
      this.buffer = this.buffer.subarray(length + 8);
      result.push({op, body});
    }
    return result;
  }
}
export function discordPaths(): string[] {
  if (process.env.DISCORD_IPC_PATH) return [process.env.DISCORD_IPC_PATH];
  if (process.platform === 'win32') return Array.from({length: 10}, (_, n) => `\\\\.\\pipe\\discord-ipc-${n}`);
  const prefixes = [...new Set([process.env.XDG_RUNTIME_DIR, process.env.TMPDIR, process.env.TMP, process.env.TEMP, '/tmp'].filter((x): x is string => !!x))];
  return prefixes.flatMap(prefix => Array.from({length: 10}, (_, n) => join(prefix, `discord-ipc-${n}`)));
}
export class DiscordClient {
  private socket?: Socket;
  private stopped = true;
  private ready = false;
  private desired: Activity | null = null;
  private lastSent: string | undefined;
  private pending?: {nonce: string; serialized: string; at: number};
  private lastWrite = 0;
  private reconnect?: ReturnType<typeof setTimeout>;
  private ticker?: ReturnType<typeof setInterval>;
  private handshake?: ReturnType<typeof setTimeout>;
  private index = 0;
  private backoff = 1000;
  status = 'disconnected';
  acknowledgedActivity: unknown = null;
  get acknowledged(): boolean { return this.ready && this.lastSent === JSON.stringify(this.desired); }
  constructor(readonly clientId: string, private readonly paths = discordPaths(), private readonly intervalMs = 5000,
    private readonly log: (message: string) => void = () => {}) {}
  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.ticker = setInterval(() => this.flush(), Math.min(this.intervalMs, 1000));
    this.connect();
  }
  setActivity(activity: Activity | null): void { this.desired = activity; this.flush(); }
  private connect(): void {
    if (this.stopped) return;
    const socket = createConnection(this.paths[this.index]); this.socket = socket;
    const decoder = new Decoder();
    this.handshake = setTimeout(() => socket.destroy(), 3000);
    socket.on('connect', () => socket.write(frame(0, {v: 1, client_id: this.clientId})));
    socket.on('error', () => {});
    socket.on('data', data => {
      try {
        for (const {op, body} of decoder.feed(data)) {
          if (op === 3) socket.write(frame(4, body));
          if (op === 2) { socket.destroy(); return; }
          if (op !== 1) continue;
          if (body.evt === 'READY') {
            clearTimeout(this.handshake); this.ready = true; this.status = 'connected';
            this.backoff = 1000; this.lastSent = undefined; this.lastWrite = 0;
            this.flush();
          } else if (body.evt === 'ERROR') {
            this.status = 'error';
            this.log(`Discord RPC error: ${JSON.stringify(body.data)}`);
            // Reconnect also retries the latest activity after a rejected command.
            socket.destroy();
          } else if (this.pending && body.nonce === this.pending.nonce) {
            this.acknowledgedActivity = body.data;
            this.lastSent = this.pending.serialized; this.pending = undefined;
            this.flush();
          }
        }
      } catch { socket.destroy(); }
    });
    socket.on('close', () => {
      clearTimeout(this.handshake); this.ready = false; this.pending = undefined;
      if (this.status !== 'error') this.status = 'disconnected';
      if (this.stopped) return;
      this.index = (this.index + 1) % this.paths.length;
      const delay = this.index === 0 ? this.backoff : 10;
      if (this.index === 0) this.backoff = Math.min(this.backoff * 2, 30_000);
      this.reconnect = setTimeout(() => this.connect(), delay);
    });
  }
  private flush(): void {
    if (!this.ready || !this.socket || this.stopped) return;
    if (this.pending) {
      if (Date.now() - this.pending.at > 10_000) this.socket.destroy();
      return;
    }
    const serialized = JSON.stringify(this.desired);
    if (serialized === this.lastSent || Date.now() - this.lastWrite < this.intervalMs) return;
    const nonce = randomUUID(); this.lastWrite = Date.now();
    this.pending = {nonce, serialized, at: this.lastWrite};
    this.socket.write(frame(1, {cmd: 'SET_ACTIVITY', args: {pid: process.pid, activity: this.desired}, nonce}));
  }
  stop(): void {
    this.stopped = true; clearInterval(this.ticker); clearTimeout(this.reconnect); clearTimeout(this.handshake);
    if (this.ready) this.socket?.end(frame(1, {cmd: 'SET_ACTIVITY', args: {pid: process.pid, activity: null}, nonce: randomUUID()}));
    else this.socket?.destroy();
    const socket = this.socket;
    setTimeout(() => socket?.destroy(), 200).unref();
    this.ready = false; this.status = 'disconnected';
  }
}
