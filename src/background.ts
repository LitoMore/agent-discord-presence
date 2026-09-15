import {spawn} from 'node:child_process';
import {mkdir, open} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir, userInfo} from 'node:os';
import {createHash} from 'node:crypto';

/** Wait for the detached service's own readiness message before releasing the terminal. */
export async function startBackground(cli: string, args: string[]): Promise<{pid: number; log: string}> {
  const id = createHash('sha256').update(userInfo().username).digest('hex').slice(0, 12);
  const directory = join(tmpdir(), `agent-presence-${id}`);
  await mkdir(directory, {recursive: true, mode: 0o700});
  const log = join(directory, 'service.log');
  const file = await open(log, 'a', 0o600);
  try {
    const child = spawn(process.execPath, [cli, 'start', ...args], {
      detached: true, windowsHide: true, stdio: ['ignore', file.fd, file.fd, 'ipc'],
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill();
        finish(new Error(`Background startup timed out; see ${log}`));
      }, 10_000);
      let settled = false;
      function finish(error?: Error) {
        if (settled) return;
        settled = true; clearTimeout(timer);
        if (child.connected) child.disconnect();
        child.unref();
        if (error) reject(error); else resolve();
      }
      child.on('error', error => finish(error));
      child.once('exit', code => finish(new Error(`Background service exited (${code}); see ${log}`)));
      child.on('message', message => {
        const result = message as {type?: string; error?: string};
        if (result.type === 'ready') finish();
        else if (result.type === 'startup-error') finish(new Error(result.error ?? 'Background startup failed'));
      });
    });
    return {pid: child.pid!, log};
  } finally { await file.close(); }
}
