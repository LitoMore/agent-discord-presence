import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {installPlugin, type PluginSource} from './agent-plugins.js';
import {fetchGithubPlugin, parseGithubSource} from './github-plugin.js';

export interface PluginInstallState {
  id: string; spec: string; phase: 'resolving' | 'downloading' | 'validating' | 'installing' | 'registering' | 'cancelling' | 'installed' | 'failed' | 'cancelled';
  bytes?: number; total?: number; agent?: string; error?: string;
}
export function installFinished(state: PluginInstallState): boolean {return ['installed', 'failed', 'cancelled'].includes(state.phase);}

export function installPluginSource(spec: string, progress: (state: PluginInstallState) => void = () => {}, signal?: AbortSignal): Promise<string> {
  if (typeof spec !== 'string' || !spec.trim() || spec.length > 4096) throw new Error('Enter a GitHub source or select a local plugin folder');
  if (spec.startsWith('github:')) parseGithubSource(spec);
  const id = randomUUID(), combined = AbortSignal.any([AbortSignal.timeout(120_000), ...signal ? [signal] : []]);
  let state: PluginInstallState = {id, spec, phase: spec.startsWith('github:') ? 'resolving' : 'validating'};
  const report = (phase: PluginInstallState['phase'], extra: Partial<PluginInstallState> = {}) => {
    state = {id, spec, phase, ...extra}; progress({...state});
  };
  return (async () => {
    let temp: string | undefined, agent: string | undefined, failure: unknown, cleanupError: string | undefined;
    try {
      report(state.phase); combined.throwIfAborted();
      let source: PluginSource | undefined, root = spec;
      if (spec.startsWith('github:')) {
        temp = await mkdtemp(join(tmpdir(), 'adp-plugin-')); root = temp;
        source = await fetchGithubPlugin(spec, root, combined, (phase, bytes, total) => report(phase, {bytes, total}));
      }
      combined.throwIfAborted(); report('installing');
      agent = await installPlugin(root, {signal: combined, source, registering: () => report('registering')});
    } catch (error) {failure = error;}
    finally {
      if (temp) try {await rm(temp, {recursive: true, force: true});} catch (error) {
        cleanupError = `Could not remove temporary plugin files: ${(error as Error).message}`;
        if (!agent) failure ??= error;
      }
    }
    // A terminal state is published only after downloads and temporary-file cleanup stop.
    if (failure !== undefined) {
      const cancelled = signal?.aborted && state.phase !== 'registering';
      report(cancelled ? 'cancelled' : 'failed', {error: cleanupError ?? (cancelled ? undefined : combined.reason?.name === 'TimeoutError' ? 'Plugin installation timed out' : (failure as Error).message)});
      throw failure;
    }
    report('installed', {agent, error: cleanupError}); return agent!;
  })();
}

let job: {state: PluginInstallState; controller: AbortController; done: Promise<string>} | undefined;
export function pluginInstallState(): PluginInstallState | null {return job ? {...job.state} : null;}
export function startPluginInstall(spec: string): void {
  if (job && !installFinished(job.state)) throw new Error('A plugin installation is already in progress');
  const controller = new AbortController();
  // Validation may throw synchronously; keep the previous result in that case.
  let initial: PluginInstallState | undefined;
  let current: typeof job;
  const done = installPluginSource(spec, state => {
    if (current) current.state = controller.signal.aborted && !installFinished(state) ? {...state, phase: 'cancelling'} : state;
    else initial = state;
  }, controller.signal);
  current = {state: initial!, controller, done}; job = current;
  void done.catch(() => {});
}
export function cancelPluginInstall(id: string): void {
  if (!job || job.state.id !== id) throw new Error('Unknown plugin installation');
  if (installFinished(job.state)) return;
  if (job.state.phase === 'registering') throw new Error('Installation is being registered; it can no longer be cancelled');
  job.state = {...job.state, phase: 'cancelling'}; job.controller.abort();
}
export async function stopPluginInstall(): Promise<void> {
  if (!job) return;
  if (!installFinished(job.state) && job.state.phase !== 'registering') cancelPluginInstall(job.state.id);
  await job.done.catch(() => {});
}
