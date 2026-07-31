// Runs a command with the installed Nodus app's provider keys injected as env vars.
//
// safeStorage only decrypts under a real Electron main process, so this runs as one,
// reads the encrypted key files from the released profile READ-ONLY, and hands the
// plaintext to a child process through the environment. Keys are never printed,
// never written to disk and never reach the parent shell.
//
//   ./node_modules/.bin/electron scripts/with-nodus-keys.cjs --providers gemini,openrouter -- node script.mjs …
const { app, safeStorage } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

app.disableHardwareAcceleration();
app.setName('Nodus');

const argv = process.argv.slice(2);
const split = argv.indexOf('--');
if (split < 0) {
  console.error('Usage: electron scripts/with-nodus-keys.cjs [--providers a,b] [--profile DIR] -- <command> [args…]');
  process.exit(2);
}
const optionOf = (name, fallback) => {
  const at = argv.indexOf(name);
  return at >= 0 && at < split && argv[at + 1] ? argv[at + 1] : fallback;
};
const providers = optionOf('--providers', 'gemini').split(',').map((p) => p.trim()).filter(Boolean);
const profile = optionOf('--profile', path.join(app.getPath('home'), 'Library/Application Support/nodus'));
const [command, ...commandArgs] = argv.slice(split + 1);

const ENV_NAME = {
  gemini: 'GEMINI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  groq: 'GROQ_API_KEY',
};

/** Mirrors electron/secrets/secretStore.ts#readKeyFile, read-only. */
function readKey(provider) {
  const candidates = [
    path.join(profile, 'secrets', `ai_key_${provider}.bin`),
    path.join(profile, `ai_key_${provider}.bin`),
  ];
  try {
    const vaults = path.join(profile, 'vaults');
    for (const name of fs.readdirSync(vaults)) candidates.push(path.join(vaults, name, `ai_key_${provider}.bin`));
  } catch {
    /* no vault directory */
  }
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const buf = fs.readFileSync(file);
    const asStr = buf.toString('utf8');
    if (asStr.startsWith('b64:')) return Buffer.from(asStr.slice(4), 'base64').toString('utf8');
    if (!safeStorage.isEncryptionAvailable()) continue;
    try {
      return safeStorage.decryptString(buf);
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

app.whenReady().then(() => {
  const env = { ...process.env };
  const found = [];
  for (const provider of providers) {
    const name = ENV_NAME[provider];
    if (!name) {
      console.error(`[keys] unknown provider "${provider}"`);
      continue;
    }
    const key = readKey(provider);
    if (key) {
      env[name] = key;
      found.push(provider);
    } else {
      console.error(`[keys] no usable key for ${provider}`);
    }
  }
  console.error(`[keys] injected: ${found.join(', ') || 'none'}`);
  // ELECTRON_RUN_AS_NODE leaks into the child otherwise and breaks a real-Electron child.
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(command, commandArgs, { stdio: 'inherit', env });
  child.on('exit', (code, signal) => app.exit(signal ? 1 : (code ?? 0)));
  child.on('error', (error) => {
    console.error(`[keys] ${error.message}`);
    app.exit(1);
  });
});
