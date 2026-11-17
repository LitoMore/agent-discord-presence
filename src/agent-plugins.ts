import {readFileSync, existsSync, realpathSync, lstatSync, readdirSync} from 'node:fs';
import {mkdir, writeFile, rename, cp, rm} from 'node:fs/promises';
import {dirname, join, resolve, relative, isAbsolute} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {socketPath} from './client.js';
import type {IntegrationEvent} from './integration-events.js';

export interface AgentDescriptor {
  id: string; name: string; enabled: boolean; plugin: boolean; installed: boolean;
  version?: string; description?: string; icon?: string; error?: string; managedIntegration?: boolean;
  locales?: Record<string, Record<string, string>>;
}
interface Manifest {apiVersion: 1; id: string; name: string; version: string; description?: string;
  icon?: string; presenceImage?: string; extension?: string; summaryWorker?: string;
  integration?: {kind: 'policy'; events: IntegrationEvent[]; removalInstructions: string};
  locales?: Record<string, Record<string, string>>;
  setup?: {kind: 'manual'; instructions: string; command?: string[]}}
interface Installation {path: string; enabled: boolean; installed: boolean}
interface Catalog {version: 1; plugins: Record<string, Installation>}
export interface AgentPlugin extends AgentDescriptor {root: string; manifest: Manifest}
const manifestCache = new Map<string, {stamp: string; value: Manifest}>();
const builtinNames: Record<string, string> = {codex: 'Codex', 'claude-code': 'Claude Code', opencode: 'OpenCode',
  pi: 'Pi', 'deepseek-harness': 'DeepSeek Harness'};
export const validAgentID = (id: unknown): id is string => typeof id === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(id) && !['constructor', 'prototype', '__proto__', 'global'].includes(id);
function pluginConfigPath(): string {
  return resolve(process.env.ADP_CONFIG ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'agent-discord-presence', 'config.json'));
}
export function pluginStatePath(): string {
  return join(dirname(pluginConfigPath()), 'plugins.json');
}
function state(): Catalog {
  const path = pluginStatePath();
  if (!existsSync(path)) return {version: 1, plugins: {}};
  if (lstatSync(path).size > 131072) throw new Error('Plugin catalog is too large');
  const text = readFileSync(path, 'utf8');
  if (Buffer.byteLength(text) > 131072) throw new Error('Plugin catalog is too large');
  const data = JSON.parse(text) as Catalog;
  if (data.version !== 1 || !data.plugins || typeof data.plugins !== 'object' || Array.isArray(data.plugins)) throw new Error('Invalid plugin catalog');
  for (const [id, value] of Object.entries(data.plugins)) {
    // Built-in integrations take precedence over records left by earlier plugin previews.
    if (Object.hasOwn(builtinNames, id)) {delete data.plugins[id]; continue;}
    if (!validAgentID(id) || Object.hasOwn(builtinNames, id) || !value || typeof value.path !== 'string' || !isAbsolute(value.path) || typeof value.enabled !== 'boolean' || typeof value.installed !== 'boolean') throw new Error('Invalid plugin catalog entry');
  }
  return data;
}
async function save(data: Catalog): Promise<void> {
  const path = pluginStatePath(); await mkdir(dirname(path), {recursive: true});
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(data, null, 2) + '\n'); await rename(temp, path);
}
function asset(root: string, path: string): string {
  if (!path || isAbsolute(path)) throw new Error('Plugin paths must be relative');
  const resolved = realpathSync(resolve(root, path));
  const rel = relative(realpathSync(root), resolved);
  if (rel.startsWith('..') || isAbsolute(rel) || !lstatSync(resolved).isFile()) throw new Error('Plugin file must stay inside its package');
  return resolved;
}
export function readPlugin(root: string): Manifest {
  const path = resolve(root, 'adp-plugin.json');
  const info = lstatSync(path);
  if (info.size > 16384) throw new Error('Plugin manifest is too large');
  const stamp = `${info.mtimeMs}:${info.ctimeMs}:${info.size}`;
  const cached = manifestCache.get(path);
  if (cached?.stamp === stamp) return cached.value;
  asset(root, 'adp-plugin.json');
  const text = readFileSync(path, 'utf8');
  if (Buffer.byteLength(text) > 16384) throw new Error('Plugin manifest is too large');
  const m = JSON.parse(text) as Manifest;
  if (m.apiVersion !== 1 || !validAgentID(m.id) || Object.hasOwn(builtinNames, m.id) || typeof m.name !== 'string' || !m.name.trim() || m.name.length > 80 || typeof m.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(m.version)) throw new Error('Invalid plugin manifest or unsupported API version');
  if (m.description !== undefined && (typeof m.description !== 'string' || m.description.length > 500)) throw new Error('Invalid plugin description');
  for (const key of ['icon', 'extension', 'summaryWorker'] as const) if (m[key] !== undefined) {if (typeof m[key] !== 'string') throw new Error('Invalid plugin file'); asset(root, m[key]!);}
  if (m.icon && (!/\.(png|svg)$/.test(m.icon) || lstatSync(asset(root, m.icon)).size > 131072)) throw new Error('Use a PNG or SVG icon up to 128 KB');
  if (m.presenceImage !== undefined && (typeof m.presenceImage !== 'string' || !m.presenceImage.startsWith('https://') || m.presenceImage.length > 2048)) throw new Error('Invalid presence image');
  if (m.setup !== undefined && (!m.setup || m.setup.kind !== 'manual' || typeof m.setup.instructions !== 'string' || m.setup.instructions.length > 4000)) throw new Error('Invalid setup instructions');
  if (m.setup?.command !== undefined && (!Array.isArray(m.setup.command) || !m.setup.command.length || m.setup.command.length > 32 ||
      m.setup.command.some(arg => typeof arg !== 'string' || !arg || arg.length > 4096 || /[\r\n\0]/.test(arg) || (/[{}]/.test(arg) && arg !== '{pluginRoot}')))) throw new Error('Invalid setup command');
  if (m.locales !== undefined) {
    if (!m.locales || typeof m.locales !== 'object' || Array.isArray(m.locales) || Object.keys(m.locales).length > 8) throw new Error('Invalid plugin locales');
    for (const [language, messages] of Object.entries(m.locales)) {
      if (!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language) || !messages || typeof messages !== 'object' || Array.isArray(messages) || Object.keys(messages).length > 128 ||
          Object.entries(messages).some(([key, value]) => !key || key.length > 4000 || typeof value !== 'string' || !value || value.length > 4000)) throw new Error('Invalid plugin locale messages');
    }
  }
  if (m.integration !== undefined) {
    const policy = m.integration;
    if (!policy || policy.kind !== 'policy' || !Array.isArray(policy.events) || !policy.events.length || policy.events.length > 64 ||
        typeof policy.removalInstructions !== 'string' || !policy.removalInstructions.trim() || policy.removalInstructions.length > 4000) throw new Error('Invalid plugin integration policy');
    const ids = new Set<string>();
    for (const event of policy.events) {
      if (!event || typeof event.id !== 'string' || !/^[A-Za-z0-9_.:/-]{1,128}$/.test(event.id) || ids.has(event.id) ||
          !['presence','waiting','tools','errors','summary','cleanup'].includes(event.capability) || typeof event.description !== 'string' || event.description.length > 500 ||
          typeof event.required !== 'boolean' || !Array.isArray(event.requires) || event.requires.length > 64 || event.requires.some(id => typeof id !== 'string') ||
          (event.source !== undefined && (typeof event.source !== 'string' || event.source.length > 128))) throw new Error('Invalid plugin integration event');
      ids.add(event.id);
    }
    if (policy.events.some(event => event.requires.some(id => !ids.has(id)))) throw new Error('Unknown plugin event dependency');
  }
  if (manifestCache.size >= 256) manifestCache.delete(manifestCache.keys().next().value!);
  manifestCache.set(path, {stamp, value: m});
  return m;
}
function entries(): Record<string, Installation> {
  return state().plugins;
}
export function listPlugins(): AgentDescriptor[] {
  return Object.entries(entries()).map(([id, record]) => {
    try {
      const m = readPlugin(record.path);
      if (m.id !== id) throw new Error('Plugin ID does not match catalog');
      let icon: string | undefined;
      if (m.icon) {
        const file = asset(record.path, m.icon);
        if (lstatSync(file).size > 131072) throw new Error('Plugin icon is too large');
        const bytes = readFileSync(file);
        if (bytes.length > 131072) throw new Error('Plugin icon is too large');
        const mime = m.icon.endsWith('.svg') ? 'image/svg+xml' : m.icon.endsWith('.png') ? 'image/png' : '';
        if (!mime) throw new Error('Use a PNG or SVG plugin icon');
        icon = `data:${mime};base64,${bytes.toString('base64')}`;
      }
      return {id, name: m.name, version: m.version, description: m.description, locales: m.locales, icon, enabled: record.enabled && record.installed,
        installed: record.installed, plugin: true, managedIntegration: !!m.integration};
    } catch (error) { return {id, name: id, plugin: true, installed: record.installed, enabled: false, error: (error as Error).message}; }
  });
}
export function listAgents(): AgentDescriptor[] {
  let plugins: AgentDescriptor[] = [];
  try {plugins = listPlugins().filter(p => p.installed);} catch { /* Core agents stay available if the plugin catalog is damaged. */ }
  return [...Object.entries(builtinNames).map(([id, name]) => ({id, name, enabled: true, installed: true, plugin: false})), ...plugins];
}
export function getPlugin(id: string): AgentPlugin | undefined {
  if (!validAgentID(id) || Object.hasOwn(builtinNames, id)) return;
  try {
    const record = entries()[id]; if (!record?.installed) return;
    const manifest = readPlugin(record.path); if (manifest.id !== id) return;
    return {id, name: manifest.name, enabled: record.enabled, installed: true, plugin: true, version: manifest.version, root: record.path, manifest};
  } catch { return; }
}
export function pluginPolicy(id: string): Manifest['integration'] { return getPlugin(id)?.manifest.integration; }
export function agentEnabled(id: string): boolean {
  if (Object.hasOwn(builtinNames, id)) return true;
  try { return getPlugin(id)?.enabled ?? false; } catch { return false; }
}
export function agentKnown(id: string): boolean {
  if (!validAgentID(id)) return false;
  // Preserve existing configuration scopes without implicitly enabling adapters.
  if (Object.hasOwn(builtinNames, id)) return true;
  try {return Object.hasOwn(entries(), id);} catch {return false;}
}
export function agentName(id: string): string {return getPlugin(id)?.name ?? builtinNames[id] ?? id;}
export function pluginFile(plugin: AgentPlugin, field: 'extension' | 'summaryWorker'): string | undefined {
  const file = plugin.manifest[field]; return file ? asset(plugin.root, file) : undefined;
}
function checkPackage(root: string): void {
  let count = 0, bytes = 0;
  function scan(dir: string) {
    for (const item of readdirSync(dir, {withFileTypes: true})) {
      if (item.isSymbolicLink()) throw new Error('Plugin packages cannot contain symbolic links');
      if (++count > 256) throw new Error('Plugin package has too many files');
      const path = join(dir, item.name);
      if (item.isDirectory()) scan(path);
      else if (item.isFile()) {bytes += lstatSync(path).size; if (bytes > 8 * 1024 * 1024) throw new Error('Plugin package exceeds 8 MB');}
      else throw new Error('Unsupported plugin file');
    }
  }
  scan(root);
}
export async function installPlugin(source: string): Promise<void> {
  if (typeof source !== 'string' || !source || source.length > 4096) throw new Error('Select a local plugin folder');
  const root = realpathSync(source); const m = readPlugin(root); checkPackage(root);
  if (listAgents().some(a => a.id !== m.id && a.name.trim().toLocaleLowerCase() === m.name.trim().toLocaleLowerCase())) throw new Error('Another Agent already uses this display name');
  const data = state();
  if (Object.values(data.plugins).filter(p => p.installed).length >= 16 && !data.plugins[m.id]?.installed) throw new Error('At most 16 local Agent plugins can be installed');
  if (data.plugins[m.id]?.installed) throw new Error('Plugin is already installed; remove it before installing another copy');
  // A unique managed copy survives changes to the selected source directory.
  const dest = join(dirname(pluginStatePath()), 'plugins', `${m.id}-${randomUUID()}`);
  await mkdir(dirname(dest), {recursive: true});
  try {await cp(root, dest, {recursive: true, dereference: false}); readPlugin(dest);
    await writeFile(join(dest, '.adp-runtime.json'), JSON.stringify({sdk: new URL('./plugin-sdk.js', import.meta.url).href, config: pluginConfigPath(), socket: socketPath()}));
    data.plugins[m.id] = {path: dest, installed: true, enabled: true}; await save(data);
  } catch (error) {await rm(dest, {recursive: true, force: true}); throw error;}
}
export async function changePlugin(id: string, action: 'enable' | 'disable' | 'remove'): Promise<void> {
  if (!['enable', 'disable', 'remove'].includes(action)) throw new Error('Unknown plugin action');
  if (!validAgentID(id) || Object.hasOwn(builtinNames, id)) throw new Error('Unknown plugin');
  const data = state(); const entry = entries()[id]; if (!entry) throw new Error('Unknown plugin');
  if (!entry.installed) throw new Error('Plugin is not installed');
  data.plugins[id] = {...entry, installed: action !== 'remove', enabled: action === 'enable'};
  if (action === 'enable') {const manifest = readPlugin(entry.path); if (manifest.id !== id) throw new Error('Plugin ID mismatch');}
  await save(data);
}
export function pluginSetup(id: string, language = 'en'): {path: string; content: string; instructions: string} | undefined {
  const plugin = getPlugin(id); if (!plugin) return;
  const setup = plugin.manifest.setup;
  const source = setup?.instructions ?? 'Configure your agent to send ADP lifecycle events.';
  const messages = plugin.manifest.locales?.[language];
  const instructions = messages && Object.hasOwn(messages, source) ? messages[source] : source;
  const quote = (value: string) => "'" + (process.platform === 'win32' ? value.replaceAll("'", "''") : value.replaceAll("'", "'\\''")) + "'";
  const args = setup?.command?.map(arg => arg === '{pluginRoot}' ? quote(plugin.root) : /^[A-Za-z0-9_./:-]+$/.test(arg) ? arg : quote(arg));
  const content = args ? (process.platform === 'win32' && args[0].startsWith("'") ? '& ' : '') + args.join(' ') : instructions;
  return {path: '', content, instructions};
}
