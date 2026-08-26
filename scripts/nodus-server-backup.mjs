import path from 'node:path';
import { createServerBackup, inspectServerBackup, restoreServerBackup } from '../server/lib/serverBackup.mjs';

const [command, ...args] = process.argv.slice(2);
const value = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : null; };
let result;
if (command === 'create') result = createServerBackup({
  dataDir: value('--data-dir'),
  outputFile: value('--output'),
  keyringFile: value('--keyring-file') || process.env.NODUS_AI_KEYRING_FILE || null,
});
else if (command === 'inspect') result = inspectServerBackup(path.resolve(value('--archive'))).manifest;
else if (command === 'restore') result = restoreServerBackup({ archiveFile: value('--archive'), targetDir: value('--target') });
else throw new Error('Usage: nodus-server-backup.mjs create --data-dir DIR --output FILE [--keyring-file FILE] | inspect --archive FILE | restore --archive FILE --target NEW_DIR');
console.log(JSON.stringify(result, null, 2));
