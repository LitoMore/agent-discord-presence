import {mkdtemp, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {startDaemon} from '../dist/daemon.js';
import {request} from '../dist/client.js';
import {generateSummary} from '../dist/generation.js';
import {loadSettings} from '../dist/settings.js';
const model = process.argv[2];
if (!model) throw new Error('Pass the current session model ID');
const directory = await mkdtemp(join(tmpdir(), 'adp-generation-test-'));
const path = join(directory, 'service.sock');
const daemon = await startDaemon({path, dryRun: true, log: () => {}, generate: (agent, response, signal, context) => generateSummary(loadSettings(), agent, response, signal, context)});
try {
  await request({type: 'event', event: {version: 1, agent: 'codex', sessionId: 'generation-test', state: 'idle', updatedAt: Date.now(), model,
    response: 'Implemented a reconnect handler for a Discord integration and added a test for restoring activity after reconnecting. The new test passes.'}}, path);
  for (let n = 0; n < 140; n++) {
    const status = await request({type: 'status'}, path);
    if (status.generation.failed) throw new Error(status.generation.lastError);
    if (status.generation.completed) {
      console.log(JSON.stringify({model, activity: status.activity, generation: status.generation}, null, 2));
      break;
    }
    if (n === 139) throw new Error('Automatic generation did not complete');
    await delay(500);
  }
} finally { await daemon.close(); await rm(directory, {recursive: true, force: true}); }
