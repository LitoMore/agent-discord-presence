import {randomUUID} from 'node:crypto';
import {buildPresencePrompt} from './prompts.js';
import {parseSummary, type Summary} from './summary.js';
import type {Settings} from './settings.js';

/** Daemon-owned policy and freshness guard; never contains host credentials. */
export interface NativeSummaryJob {
  key: string; updatedAt: number; startedAt: number; revision: number;
  model: string; provider: string; settings: string;
  input: ReturnType<typeof buildPresencePrompt>;
}
export function nativeSummarySettings(settings: Settings): string {
  return JSON.stringify([settings.enabled, settings.service, settings.model, settings.provider, settings.customPrompt, settings.maxLength]);
}
interface Chunk {type: string; index?: number; text?: string; blockType?: string; block?: {type: string; text?: string}; reason?: {kind: string}}
export interface HarnessLlm {
  stream(options: {
    provider: string; model: string; system: string; maxTokens: number; signal: AbortSignal;
    messages: {id: string; role: 'user'; content: {type: 'text'; text: string}[]; source: {kind: 'plugin'; plugin: string}}[];
  }): AsyncIterable<Chunk>;
}
/** Auxiliary one-shot call: no agent loop, conversation history, or tools. */
export async function harnessSummary(llm: HarnessLlm, job: NativeSummaryJob, signal: AbortSignal): Promise<Summary> {
  const blocks = new Map<number, string>();
  let size = 0; let finished = false;
  for await (const chunk of llm.stream({provider: job.provider, model: job.model,
    system: job.input.systemPrompt + '\nReturn JSON matching this schema:\n' + JSON.stringify(job.input.schema),
    messages: [{id: randomUUID(), role: 'user', content: [{type: 'text', text: job.input.prompt}],
      source: {kind: 'plugin', plugin: 'agent-discord-presence'}}], maxTokens: 2048, signal})) {
    signal.throwIfAborted();
    if (finished) throw new Error('Unexpected output after finish');
    if (chunk.type === 'tool-call-delta' || chunk.blockType === 'tool-call' || chunk.block?.type === 'tool-call') throw new Error('Unexpected summary tool call');
    if (chunk.type === 'text-delta' && chunk.index !== undefined) {
      const text = chunk.text ?? ''; size += text.length;
      blocks.set(chunk.index, (blocks.get(chunk.index) ?? '') + text);
    }
    if (chunk.type === 'block-end' && chunk.block?.type === 'text' && chunk.index !== undefined) {
      const text = chunk.block.text ?? ''; size += text.length - (blocks.get(chunk.index)?.length ?? 0);
      blocks.set(chunk.index, text);
    }
    if (size > 16_384 || blocks.size > 32) throw new Error('Summary output too large');
    if (chunk.type === 'finish') {
      if (chunk.reason?.kind !== 'stop') throw new Error('Summary generation did not complete');
      finished = true;
    }
  }
  signal.throwIfAborted();
  if (!finished) throw new Error('Summary stream ended without finish');
  const summary = parseSummary(JSON.parse([...blocks.entries()].sort(([a], [b]) => a - b).map(([, text]) => text).join('')));
  if (Array.from(summary.topic).length > job.input.schema.properties.topic.maxLength ||
      Array.from(summary.subtitle).length > job.input.schema.properties.subtitle.maxLength) throw new Error('Summary exceeds configured length');
  return summary;
}
