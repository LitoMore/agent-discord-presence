import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {catalogFor, selectEvents, validateEvents, type EventSelection} from './integration-events.js';
import type {Agent} from './protocol.js';
import {settingsPath} from './settings.js';

export const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
export function policyPath(): string { return resolve(dirname(settingsPath()), 'integrations', 'deepseek-harness.json'); }
export function adapterEvents(agent: Agent, options?: EventSelection): Set<string> {
  if (options) return new Set(selectEvents(agent, options));
  if (agent === 'deepseek-harness') {
    try { return new Set(validateEvents(agent, JSON.parse(readFileSync(policyPath(), 'utf8')).events)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return new Set(catalogFor(agent).filter(e => e.required).map(e => e.id));
    }
  }
  return new Set(selectEvents(agent));
}
export function entryContent(agent: 'opencode' | 'pi', events: string[], source = new URL(`./adapters/${agent}.js`, import.meta.url).href): string {
  const all = selectEvents(agent);
  if (JSON.stringify(events) === JSON.stringify(all)) return agent === 'pi'
    ? `export { default } from ${JSON.stringify(source)};` : `export { AgentPresence } from ${JSON.stringify(source)};`;
  const options = JSON.stringify({events});
  return agent === 'pi'
    ? `import presence from ${JSON.stringify(source)};\nexport default function(pi) { return presence(pi, ${options}); }`
    : `import { AgentPresence as presence } from ${JSON.stringify(source)};\nexport const AgentPresence = presence.withEvents(${options});`;
}
export function parseEntry(source: string, agent: 'opencode' | 'pi'): {source: string; events: string[]} | undefined {
  const text = source.trim();
  const name = agent === 'pi' ? 'default' : 'AgentPresence';
  const match = text.match(new RegExp(`^export\\s*\\{\\s*${name}\\s*\\}\\s*from\\s*("(?:[^"\\\\]|\\\\.)*"|'[^'\\\\]*')\\s*;?$`));
  try {
    if (match) return {source: match[1][0] === '"' ? JSON.parse(match[1]) : match[1].slice(1, -1), events: selectEvents(agent)};
    const specifier = text.match(/from ("(?:[^"\\]|\\.)*");\n/)?.[1];
    const raw = text.match(/\{"events":\[.*\]\}/)?.[0];
    if (!specifier || !raw) return;
    const events = validateEvents(agent, JSON.parse(raw).events);
    const target: string = JSON.parse(specifier);
    if (entryContent(agent, events, target) === text) return {source: target, events};
  } catch { /* Custom or invalid code is never rewritten. */ }
}
