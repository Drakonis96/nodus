import { Worker } from 'node:worker_threads';

// PDF.js and other Node libraries intentionally reject Electron's utility
// process.type. Run the existing Node worker in this dedicated OS process,
// retaining its tested Node environment without mutating runtime identity.
// Killing the owning utility also terminates synchronous work in its thread.
const port = process.parentPort;
if (!port || !process.argv[2]) throw new Error('Missing background utility target');
const worker = new Worker(process.argv[2]);
port.on('message', message => worker.postMessage(message.data));
worker.on('message', message => port.postMessage(message));
worker.once('error', () => process.exit(1));
worker.once('exit', code => process.exit(code));
