import {randomUUID} from 'node:crypto';
import {join} from 'node:path';

// Windows net.Server uses named pipes; Unix uses a socket inside the temp dir.
export const ipcPath = (dir, name = 'service.sock') => process.platform === 'win32'
  ? `\\\\.\\pipe\\adp-test-${process.pid}-${randomUUID()}` : join(dir, name);
