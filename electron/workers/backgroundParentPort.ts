import { parentPort as threadPort } from 'node:worker_threads';

/** The same extraction algorithms run in utilities, Node children and direct
 * worker-thread unit fixtures. No Electron application module is imported here. */
export const parentPort = threadPort ?? {
  on(event: 'message', listener: (message: any) => void) {
    if (process.parentPort) process.parentPort.on(event, message => listener(message.data));
    else process.on(event, listener);
  },
  once(event: 'message', listener: (message: any) => void) {
    if (process.parentPort) process.parentPort.once(event, message => listener(message.data));
    else process.once(event, listener);
  },
  postMessage(message: unknown) {
    if (process.parentPort) process.parentPort.postMessage(message);
    else if (process.send) process.send(message as Parameters<typeof process.send>[0]);
    else throw new Error('Missing background process IPC');
  },
};

if (!threadPort && !process.parentPort && process.send) process.once('disconnect', () => process.exit(0));
