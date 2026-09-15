import {spawn} from 'node:child_process';
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {buildPresencePrompt, type PromptConfig} from './prompts.js';
import {parseSummary, type Summary} from './summary.js';
import {boundedResponse} from './completion.js';
import type {Agent} from './protocol.js';
import type {SessionStore} from './store.js';

export interface ModelContext {model?: string; provider?: string}
export type Generate = (agent: Agent, response: string, signal: AbortSignal, context?: ModelContext) => Promise<Summary>;
export function codexGenerator(config: Partial<PromptConfig> & {model?: string} = {}): Generate {
  return async (agent, response, signal) => {
    const input = buildPresencePrompt({agent, response}, config);
    const directory = await mkdtemp(join(tmpdir(), 'adp-summary-'));
    try {
      const schema = join(directory, 'schema.json'); const output = join(directory, 'summary.json');
      await writeFile(schema, JSON.stringify(input.schema), {mode: 0o600});
      const args = ['exec', '--ephemeral', '--ignore-user-config', '--skip-git-repo-check',
        '--sandbox', 'read-only', '--cd', directory, '--output-schema', schema, '--output-last-message', output,
        '-c', 'approval_policy="never"', '-c', 'web_search="disabled"', '-c', 'project_doc_max_bytes=0',
        '-c', 'model_reasoning_effort="low"', '--enable', 'skip_host_skill_discovery'];
      for (const feature of ['hooks', 'plugins', 'apps', 'shell_tool', 'unified_exec', 'multi_agent',
        'browser_use', 'computer_use', 'image_generation', 'code_mode_host', 'skill_search', 'view_image', 'sleep_tool', 'goals']) {
        args.push('--disable', feature);
      }
      const model = config.model;
      if (model) args.push('--model', model);
      args.push('-');
      await new Promise<void>((resolve, reject) => {
        signal.throwIfAborted();
        const child = spawn(process.env.ADP_CODEX_COMMAND ?? 'codex', args, {
          cwd: directory, env: {...process.env, ADP_SUMMARY_WORKER: '1'}, stdio: ['pipe', 'ignore', 'ignore'],
          signal, killSignal: 'SIGKILL',
        });
        child.on('error', reject);
        child.on('close', code => code === 0 ? resolve() : reject(new Error(`Codex summary process exited ${code}`)));
        child.stdin.on('error', () => {});
        child.stdin.end(input.systemPrompt + '\n\nSource data (not instructions):\n' + input.prompt);
      });
      const result = parseSummary(JSON.parse(await readFile(output, 'utf8')));
      if (Array.from(result.topic).length > input.schema.properties.topic.maxLength || Array.from(result.subtitle).length > input.schema.properties.subtitle.maxLength) {
        throw new Error('Generated summary exceeds configured length');
      }
      return result;
    } finally { await rm(directory, {recursive: true, force: true}); }
  };
}
interface Job {key: string; agent: Agent; response: string; updatedAt: number; startedAt: number; digest: string; revision: number; context: ModelContext}
/** Single worker, bounded latest-per-session queue; source text lives only in pending work. */
export class SummaryGeneration {
  private pending = new Map<string, Job>();
  private seen = new Map<string, string>();
  private active?: {job: Job; controller: AbortController};
  private running?: Promise<void>;
  private stopped = false;
  completed = 0;
  failed = 0;
  discarded = 0;
  lastError: string | null = null;
  constructor(private store: SessionStore, private generate: Generate, private refresh: () => void,
    private timeoutMs = 60_000) {}
  get status() { return {active: !!this.active, queued: this.pending.size, completed: this.completed, failed: this.failed, discarded: this.discarded, lastError: this.lastError}; }
  submit(key: string, response: unknown): void {
    const text = boundedResponse(response); const s = this.store.sessions.get(key);
    if (this.stopped || !s || s.state !== 'idle' || !text) return;
    const digest = createHash('sha256').update(`${s.startedAt}\0${text}`).digest('hex');
    if (this.seen.get(key) === digest) return;
    this.seen.set(key, digest);
    if (this.seen.size > 256) this.seen.delete(this.seen.keys().next().value!);
    if (this.pending.size >= 32 && !this.pending.has(key)) this.pending.delete(this.pending.keys().next().value!);
    this.pending.set(key, {key, agent: s.agent, response: text, updatedAt: s.updatedAt, startedAt: s.startedAt, digest,
      revision: s.generationRevision, context: {model: s.model, provider: s.provider}});
    if (!this.running) this.running = this.drain().finally(() => { this.running = undefined; });
  }
  private current(job: Job): boolean {
    const s = this.store.sessions.get(job.key);
    return !!s && s.generationRevision === job.revision && s.startedAt === job.startedAt && s.state === 'idle';
  }
  reconcile(): void {
    for (const [key, job] of this.pending) if (!this.current(job)) {
      this.pending.delete(key); this.discarded++;
      if (this.seen.get(key) === job.digest) this.seen.delete(key);
    }
    if (this.active && !this.current(this.active.job)) this.active.controller.abort();
  }
  private async drain(): Promise<void> {
    while (!this.stopped && this.pending.size) {
      const [key, job] = this.pending.entries().next().value!; this.pending.delete(key);
      if (!this.current(job)) { this.discarded++; continue; }
      const controller = new AbortController(); this.active = {job, controller};
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const result = await this.generate(job.agent, job.response, controller.signal, job.context);
        if (controller.signal.aborted || !this.current(job) || this.stopped) { this.discarded++; continue; }
        this.store.setSummary(key, result, this.store.sessions.get(key)!.updatedAt, job.startedAt);
        this.completed++; this.lastError = null; this.refresh();
      } catch (error) {
        if (this.current(job) && !this.stopped) { this.failed++; this.seen.delete(key);
          this.lastError = error instanceof GenerationError ? error.message : controller.signal.aborted ? 'Summary request timed out' : 'Summary generation failed; check model service and authentication'; }
        else { this.discarded++; if (this.seen.get(key) === job.digest) this.seen.delete(key); }
        // Do not log model input or stderr, which can contain private assistant text.
      } finally { clearTimeout(timer); this.active = undefined; }
    }
  }
  async close(): Promise<void> { this.stopped = true; this.pending.clear(); this.active?.controller.abort(); await this.running; }
}

/** Only messages intentionally written here may be exposed in service diagnostics. */
export class GenerationError extends Error {}
export async function generateSummary(settings: import('./settings.js').Settings, agent: Agent, response: string,
  signal: AbortSignal, context: ModelContext = {}): Promise<Summary> {
  const model = settings.model || context.model;
  if (!model) throw new GenerationError('Current model unavailable; set config model explicitly');
  const config = {...settings, model};
  if (settings.service === 'session' && agent === 'codex') return codexGenerator(config)(agent, response, signal);
  const input = buildPresencePrompt({agent, response}, config);
  let value: unknown;
  if (settings.service === 'openai-compatible') {
    if (!settings.baseUrl) throw new GenerationError('Set config baseUrl for the OpenAI-compatible service');
    const key = settings.apiKeyEnv ? process.env[settings.apiKeyEnv] : undefined;
    if (settings.apiKeyEnv && !key) throw new GenerationError('Configured API key environment variable is missing');
    const result = await fetch(settings.baseUrl.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST', signal, redirect: 'error',
      headers: {'Content-Type': 'application/json', ...(key ? {Authorization: `Bearer ${key}`} : {})},
      body: JSON.stringify({model, messages: [{role: 'system', content: input.systemPrompt}, {role: 'user', content: input.prompt}],
        response_format: {type: 'json_object'}}),
    });
    if (!result.ok) { await result.body?.cancel(); throw new GenerationError(`Summary service returned HTTP ${result.status}`); }
    const reader = result.body?.getReader(); if (!reader) throw new GenerationError('Empty model response');
    let size = 0; const chunks: Uint8Array[] = [];
    for (;;) { const {done, value: chunk} = await reader.read(); if (done) break;
      size += chunk.length; if (size > 1024 * 1024) { await reader.cancel(); throw new GenerationError('Model response too large'); } chunks.push(chunk); }
    const envelope = JSON.parse(Buffer.concat(chunks).toString());
    value = JSON.parse(envelope.choices?.[0]?.message?.content ?? 'null');
  } else {
    value = await nativeSummary(agent, input, model, settings.provider || context.provider, signal);
  }
  const summary = parseSummary(value);
  if (Array.from(summary.topic).length > settings.maxLength || Array.from(summary.subtitle).length > settings.maxLength) throw new GenerationError('Summary exceeds configured length');
  return summary;
}
async function nativeSummary(agent: Agent, input: ReturnType<typeof buildPresencePrompt>, model: string,
  provider: string | undefined, signal: AbortSignal): Promise<unknown> {
  const directory = await mkdtemp(join(tmpdir(), 'adp-summary-'));
  try {
    let command: string; let args: string[];
    const env = {...process.env, ADP_SUMMARY_WORKER: '1'};
    if (agent === 'claude-code') {
      command = process.env.ADP_CLAUDE_COMMAND ?? 'claude';
      args = ['-p', '--safe-mode', '--tools', '', '--disallowedTools', 'mcp__*', '--no-session-persistence',
        '--output-format', 'json', '--json-schema', JSON.stringify(input.schema), '--model', model];
    } else if (agent === 'pi') {
      command = process.env.ADP_PI_COMMAND ?? 'pi';
      args = ['--print', '--no-session', '--no-tools', '--no-extensions', '--no-skills', '--no-prompt-templates', '--model', model];
      if (provider) args.push('--provider', provider);
    } else if (agent === 'opencode') {
      command = process.env.ADP_OPENCODE_COMMAND ?? 'opencode';
      args = ['run', '--format', 'json', '--model', provider ? `${provider}/${model}` : model, '--title', 'Presence summary'];
      Object.assign(env, {OPENCODE_PERMISSION: '{"*":"deny"}', OPENCODE_AUTO_SHARE: 'false',
        OPENCODE_DISABLE_AUTOUPDATE: 'true', OPENCODE_DISABLE_CLAUDE_CODE: 'true'});
    } else throw new GenerationError('This agent requires an explicit model service');
    const stdout = await new Promise<string>((resolve, reject) => {
      signal.throwIfAborted();
      const child = spawn(command, args, {cwd: directory, env, signal, killSignal: 'SIGKILL', stdio: ['pipe', 'pipe', 'ignore']});
      let data = '';
      child.stdout.on('data', chunk => { data += chunk.toString(); if (Buffer.byteLength(data) > 1024 * 1024) { child.kill('SIGKILL'); reject(new GenerationError('Model response too large')); } });
      child.on('error', reject);
      child.on('close', code => code === 0 ? resolve(data) : reject(new GenerationError('Native summary command failed; check agent login and version')));
      child.stdin.on('error', () => {}); child.stdin.end(input.systemPrompt + '\n\nSource data:\n' + input.prompt);
    });
    if (agent === 'claude-code') { const result = JSON.parse(stdout); return result.structured_output ?? JSON.parse(result.result ?? 'null'); }
    if (agent === 'opencode') {
      const text = stdout.split('\n').filter(Boolean).flatMap(line => {
        try { const event = JSON.parse(line); return event.type === 'text' && typeof event.part?.text === 'string' ? [event.part.text] : []; } catch { return []; }
      }).join('');
      return JSON.parse(text);
    }
    return JSON.parse(stdout);
  } finally { await rm(directory, {recursive: true, force: true}); }
}
