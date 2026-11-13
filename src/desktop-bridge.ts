import {createInterface} from 'node:readline';
import {handleDesktopRequest} from './desktop.js';

// Stdout carries JSON only. The persistent worker avoids spawning Node per poll.
const input = createInterface({input: process.stdin, crlfDelay: Infinity});
for await (const line of input) {
  let result;
  try {
    if (Buffer.byteLength(line) > 131_072) throw new Error('Desktop request too large');
    result = await handleDesktopRequest(JSON.parse(line));
  } catch (error) { result = {ok: false, error: (error as Error).message}; }
  process.stdout.write(JSON.stringify(result) + '\n');
}
