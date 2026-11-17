import {spawn} from 'node:child_process';
import {getPlugin, pluginFile} from './agent-plugins.js';
/** Only explicitly installed and enabled plugins execute code. */
export async function pluginSummary(agent: string, input: unknown, signal: AbortSignal): Promise<unknown> {
  const plugin = getPlugin(agent);
  if (!plugin?.enabled) throw new Error('Agent plugin is disabled or unavailable');
  const entry = pluginFile(plugin, 'summaryWorker');
  if (!entry) throw new Error('This plugin requires an explicit model service');
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry], {cwd: plugin.root, env: {...process.env, ADP_SUMMARY_WORKER: '1'},
      detached: process.platform !== 'win32', windowsHide: true, stdio: ['pipe', 'pipe', 'ignore']});
    let output = '', settled = false;
    function killTree() {
      if (!child.pid) return;
      if (process.platform === 'win32') {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {windowsHide: true, stdio: 'ignore'});
        killer.on('error', () => child.kill('SIGKILL'));
      } else {try {process.kill(-child.pid, 'SIGKILL');} catch {child.kill('SIGKILL');}}
    }
    function finish(error?: unknown, result?: unknown) {
      if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(result);
    }
    const abort = () => {killTree(); finish(signal.reason ?? new Error('Summary cancelled'));};
    const timer = setTimeout(() => {killTree(); finish(new Error('Plugin summary timed out'));}, 60_000);
    signal.addEventListener('abort', abort, {once: true}); if (signal.aborted) abort();
    child.on('error', error => finish(error));
    child.stdout.on('data', chunk => {output += chunk; if (Buffer.byteLength(output) > 65536) {killTree(); finish(new Error('Plugin summary output is too large'));}});
    child.on('close', code => {
      if (code !== 0) {finish(new Error('Plugin summary failed; check the agent login and model')); return;}
      try {finish(undefined, JSON.parse(output));} catch {finish(new Error('Plugin returned invalid summary JSON'));}
    });
    child.stdin.on('error', () => {}); child.stdin.end(JSON.stringify(input));
  });
}
