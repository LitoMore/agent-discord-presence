import {accessSync, constants, realpathSync} from 'node:fs';
import {delimiter, isAbsolute, join, resolve} from 'node:path';
import {quote} from './integration-config.js';

// Keep this wrapper exact so setup/uninstall can recognize it without evaluating shell code.
// Resolve Node in the agent's environment on every invocation. The saved executable is
// only a fallback for GUI agents whose PATH omits the user's Node installation.
export const nodeLauncher = 'adp_node=$1; shift; if [ -n "${ADP_NODE:-}" ]; then exec "$ADP_NODE" "$@"; fi; if command -v node >/dev/null 2>&1; then exec node "$@"; fi; exec "$adp_node" "$@"';

export function nodeExecutable(env: NodeJS.ProcessEnv = process.env, executable = process.execPath): string {
  if (env.ADP_NODE) return env.ADP_NODE;
  // The desktop bridge knows which launcher it used. Manager shims (for example
  // Volta/asdf) are executables rather than symlinks to process.execPath.
  if (env.ADP_NODE_HINT && isAbsolute(env.ADP_NODE_HINT)) {
    try { accessSync(env.ADP_NODE_HINT, constants.X_OK); return env.ADP_NODE_HINT; }
    catch { /* Fall back if the desktop launch path has disappeared. */ }
  }
  // Node resolves symlinks in execPath. Preserve the original PATH entry instead,
  // regardless of which installer or version manager supplied it.
  const candidates = (env.PATH ?? '').split(delimiter)
    .filter(directory => directory && isAbsolute(directory)).map(directory => join(directory, process.platform === 'win32' ? 'node.exe' : 'node'));
  for (const candidate of candidates) {
    if (!candidate || !isAbsolute(candidate)) continue;
    try {
      accessSync(candidate, constants.X_OK);
      if (realpathSync(candidate) === realpathSync(executable)) return resolve(candidate);
    } catch { /* Ignore stale PATH entries. */ }
  }
  return executable;
}

export function nodeCommand(cli: string): string {
  if (process.platform === 'win32') throw new Error('On Windows, install the CLI on PATH and use the bundled plugin hooks');
  return `/bin/sh -c ${quote(nodeLauncher)} adp-node ${quote(nodeExecutable())} ${quote(cli)}`;
}
