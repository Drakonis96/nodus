// Minimal `electron` stub for headless smoke tests (esbuild --alias:electron=…).
// Only what the DB/AI modules touch at import time is provided; safeStorage is
// never actually invoked on the pure-assembly code path.
const tmp = process.env.NODUS_TEST_USERDATA || '/tmp/nodus-smoke-userdata';
export const app = { getPath: () => tmp };
export const safeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: (s) => Buffer.from(String(s)),
  decryptString: (b) => Buffer.from(b).toString(),
};
export default { app, safeStorage };
