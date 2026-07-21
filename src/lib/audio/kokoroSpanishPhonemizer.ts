import {
  normalizeKokoroSpanishPhonemes,
  prepareKokoroSpanishText,
} from './kokoroSpanishText';

// These are the version-pinned browser assets published by piper-wasm. Nodus's
// Piper provider already uses the same URLs through vits-web, so both engines
// share the browser cache instead of packaging a second 18 MB eSpeak data file.
const PIPER_PHONEMIZE_ASSET_BASE =
  'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize';

interface PiperPhonemizeModule {
  callMain(args: string[]): number | void;
}

interface PiperPhonemizeOutput {
  phonemes?: unknown;
}

interface PendingOutput {
  resolve: (phonemes: string) => void;
  reject: (reason: Error) => void;
  settled: boolean;
}

let modulePromise: Promise<PiperPhonemizeModule> | null = null;
let pendingOutput: PendingOutput | null = null;
let runQueue: Promise<void> = Promise.resolve();

function consumeOutput(line: string): void {
  const pending = pendingOutput;
  if (!pending || pending.settled) return;

  try {
    const output = JSON.parse(line) as PiperPhonemizeOutput;
    if (!Array.isArray(output.phonemes) || !output.phonemes.every((item) => typeof item === 'string')) {
      throw new Error('eSpeak NG devolvió una respuesta sin fonemas');
    }
    pending.settled = true;
    pending.resolve(output.phonemes.join(''));
  } catch (error) {
    pending.settled = true;
    pending.reject(error instanceof Error ? error : new Error(String(error)));
  }
}

function consumeError(line: string): void {
  const pending = pendingOutput;
  if (!pending || pending.settled) return;
  pending.settled = true;
  pending.reject(new Error(`Error del fonetizador español de eSpeak NG: ${line}`));
}

async function loadPhonemizer(): Promise<PiperPhonemizeModule> {
  if (!modulePromise) {
    modulePromise = import('@diffusionstudio/piper-wasm')
      .then(({ default: createPiperPhonemize }) =>
        createPiperPhonemize({
          print: consumeOutput,
          printErr: consumeError,
          locateFile: (file: string) => {
            if (file.endsWith('.wasm')) return `${PIPER_PHONEMIZE_ASSET_BASE}.wasm`;
            if (file.endsWith('.data')) return `${PIPER_PHONEMIZE_ASSET_BASE}.data`;
            return file;
          },
        })
      )
      .catch((error) => {
        // A transient download/init failure must not poison every later attempt.
        modulePromise = null;
        throw error;
      });
  }
  return modulePromise;
}

async function runPhonemizer(text: string): Promise<string> {
  const module = await loadPhonemizer();
  const input = JSON.stringify([{ text: prepareKokoroSpanishText(text.trim()) }]);

  try {
    const ipa = await new Promise<string>((resolve, reject) => {
      const output: PendingOutput = { resolve, reject, settled: false };
      pendingOutput = output;
      try {
        module.callMain([
          '-l',
          'es',
          '--input',
          input,
          '--espeak_data',
          '/espeak-ng-data',
        ]);
        if (!output.settled) {
          output.settled = true;
          reject(new Error('eSpeak NG terminó sin devolver fonemas'));
        }
      } catch (error) {
        if (!output.settled) {
          output.settled = true;
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      }
    });
    return normalizeKokoroSpanishPhonemes(ipa);
  } finally {
    pendingOutput = null;
  }
}

/**
 * Phonemize Spanish with eSpeak NG and adapt its IPA to Kokoro's tokenizer.
 * Calls are serialized because the Emscripten module owns process-global stdout.
 */
export function phonemizeKokoroSpanish(text: string): Promise<string> {
  const result = runQueue.then(() => runPhonemizer(text));
  runQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}
