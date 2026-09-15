import {writeFile} from 'node:fs/promises';
import {hookConfig} from '../dist/adapters/hooks.js';
for (const agent of ['codex', 'claude-code']) {
  await writeFile(new URL(`../plugins/${agent}/agent-discord-presence/hooks/hooks.json`, import.meta.url), JSON.stringify(hookConfig(agent), null, 2) + '\n');
}
