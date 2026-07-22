// Presenter import conversion — turns externally-authored slide decks into the
// PDF representation consumed by every existing presenter surface. It deliberately
// uses an already-installed office suite instead of bundling one into Nodus.
// Providers are attempted in fidelity-friendly order and failures fall through to
// the next installed option. All processes receive paths as argv/environment
// values (never a shell command), and work only inside a unique temporary folder.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import type {
  PresenterConverter,
  PresenterImportErrorCode,
  PresenterImportFormat,
} from '@shared/presenterTypes';

export const PRESENTER_IMPORT_EXTENSIONS: readonly PresenterImportFormat[] = [
  'pdf', 'pptx', 'ppt', 'pptm', 'ppsx', 'pps', 'odp', 'key',
];

const OFFICE_OPEN_XML = new Set<PresenterImportFormat>(['pptx', 'pptm', 'ppsx']);
const CONVERSION_TIMEOUT_MS = 180_000;
const NATIVE_APP_TIMEOUT_MS = 60_000;

export class PresentationConversionError extends Error {
  constructor(
    readonly code: PresenterImportErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PresentationConversionError';
  }
}

export interface ConvertedPresentation {
  pdfPath: string;
  converter: PresenterConverter;
  cleanup(): void;
}

type RunProcess = (
  executable: string,
  args: readonly string[],
  options?: { env?: NodeJS.ProcessEnv; timeout?: number },
) => Promise<void>;

export interface ConversionDependencies {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  exists?: (candidate: string) => boolean;
  run?: RunProcess;
  makeTempDir?: () => string;
}

type Provider = {
  id: PresenterConverter;
  available: boolean;
  convert: (sourcePath: string, outputDir: string, outputPath: string) => Promise<string>;
};

export function presenterImportFormat(filePath: string): PresenterImportFormat | null {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return PRESENTER_IMPORT_EXTENSIONS.includes(ext as PresenterImportFormat)
    ? (ext as PresenterImportFormat)
    : null;
}

export function canExtractOpenXmlNotes(format: PresenterImportFormat): boolean {
  return OFFICE_OPEN_XML.has(format);
}

/** Locate LibreOffice without launching a shell. Exported for deterministic tests. */
export function findLibreOfficeBinary(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  exists: (candidate: string) => boolean = fs.existsSync,
): string | null {
  const candidates: string[] = [];
  const pathApi = platform === 'win32' ? path.win32 : path;
  if (platform === 'darwin') {
    candidates.push(
      '/Applications/LibreOffice.app/Contents/MacOS/soffice',
      path.join(os.homedir(), 'Applications', 'LibreOffice.app', 'Contents', 'MacOS', 'soffice'),
      '/opt/homebrew/bin/soffice',
      '/usr/local/bin/soffice',
    );
  } else if (platform === 'win32') {
    for (const root of [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA]) {
      if (root) candidates.push(pathApi.join(root, 'LibreOffice', 'program', 'soffice.exe'));
    }
  } else {
    candidates.push('/usr/bin/soffice', '/usr/local/bin/soffice', '/snap/bin/libreoffice');
  }
  const delimiter = platform === 'win32' ? path.win32.delimiter : path.delimiter;
  for (const dir of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
    candidates.push(pathApi.join(dir, platform === 'win32' ? 'soffice.exe' : 'soffice'));
    if (platform !== 'win32') candidates.push(pathApi.join(dir, 'libreoffice'));
  }
  return candidates.find((candidate) => exists(candidate)) ?? null;
}

export async function convertPresentationToPdf(
  sourcePath: string,
  dependencies: ConversionDependencies = {},
): Promise<ConvertedPresentation> {
  const format = presenterImportFormat(sourcePath);
  if (!format || format === 'pdf') {
    throw new PresentationConversionError('unsupported-format', 'The selected file is not a convertible presentation');
  }
  if (!fs.existsSync(sourcePath)) {
    throw new PresentationConversionError('invalid-file', 'The selected presentation no longer exists');
  }

  const platform = dependencies.platform ?? process.platform;
  const env = dependencies.env ?? process.env;
  const exists = dependencies.exists ?? fs.existsSync;
  const run = dependencies.run ?? runProcess;
  const tempDir = dependencies.makeTempDir?.() ?? fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-presenter-convert-'));
  const outputPath = path.join(tempDir, 'converted.pdf');
  const providers = buildProviders(format, platform, env, exists, run);
  const available = providers.filter((provider) => provider.available);
  if (available.length === 0) {
    removeTemp(tempDir);
    throw new PresentationConversionError('no-converter', 'No compatible presentation application is installed');
  }

  const failures: string[] = [];
  for (const provider of available) {
    try {
      const produced = await provider.convert(sourcePath, tempDir, outputPath);
      if (!isUsablePdf(produced)) throw new Error('The converter did not produce a valid PDF');
      return {
        pdfPath: produced,
        converter: provider.id,
        cleanup: () => removeTemp(tempDir),
      };
    } catch (error) {
      failures.push(`${provider.id}: ${error instanceof Error ? error.message : String(error)}`);
      try {
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      } catch {
        // A later provider can still use a different output file in the same temp dir.
      }
    }
  }

  removeTemp(tempDir);
  throw new PresentationConversionError('conversion-failed', failures.join('\n'));
}

function buildProviders(
  format: PresenterImportFormat,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  exists: (candidate: string) => boolean,
  run: RunProcess,
): Provider[] {
  const libreOffice = findLibreOfficeBinary(platform, env, exists);
  const powerpointAvailable = platform === 'win32'
    ? windowsPowerPointExists(env, exists)
    : platform === 'darwin' && macAppExists('Microsoft PowerPoint.app', exists);
  const keynoteAvailable = platform === 'darwin' && macAppExists('Keynote.app', exists);

  const powerpoint: Provider = {
    id: 'powerpoint',
    available: powerpointAvailable && format !== 'odp' && format !== 'key',
    convert: (source, _dir, output) => platform === 'win32'
      ? convertWithWindowsPowerPoint(source, output, run, env)
      : convertWithMacPowerPoint(source, output, run, env),
  };
  const keynote: Provider = {
    id: 'keynote',
    available: keynoteAvailable && format !== 'odp',
    convert: (source, _dir, output) => convertWithKeynote(source, output, run, env),
  };
  const libreoffice: Provider = {
    id: 'libreoffice',
    available: Boolean(libreOffice) && format !== 'key',
    convert: (source, dir) => convertWithLibreOffice(libreOffice!, source, dir, run, env),
  };

  if (format === 'key') return [keynote];
  if (format === 'odp') return [libreoffice];
  // LibreOffice is headless on macOS, while automating PowerPoint/Keynote may
  // surface first-run or file-access dialogs. Prefer the silent route there and
  // retain the native apps as fallbacks. Windows PowerPoint COM stays first for
  // maximum fidelity and opens the deck without a window.
  return platform === 'darwin'
    ? [libreoffice, powerpoint, keynote]
    : [powerpoint, libreoffice, keynote];
}

function macAppExists(appName: string, exists: (candidate: string) => boolean): boolean {
  return [path.join('/Applications', appName), path.join(os.homedir(), 'Applications', appName)]
    .some((candidate) => exists(candidate));
}

function windowsPowerPointExists(env: NodeJS.ProcessEnv, exists: (candidate: string) => boolean): boolean {
  const candidates: string[] = [];
  for (const root of [env.ProgramFiles, env['ProgramFiles(x86)']]) {
    if (!root) continue;
    candidates.push(
      path.win32.join(root, 'Microsoft Office', 'root', 'Office16', 'POWERPNT.EXE'),
      path.win32.join(root, 'Microsoft Office', 'Office16', 'POWERPNT.EXE'),
      path.win32.join(root, 'Microsoft Office', 'Office15', 'POWERPNT.EXE'),
    );
  }
  return candidates.some((candidate) => exists(candidate));
}

async function convertWithLibreOffice(
  executable: string,
  sourcePath: string,
  outputDir: string,
  run: RunProcess,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const profileDir = path.join(outputDir, 'libreoffice-profile');
  fs.mkdirSync(profileDir, { recursive: true });
  await run(executable, [
    '--headless',
    `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
    '--convert-to', 'pdf',
    '--outdir', outputDir,
    sourcePath,
  ], { env, timeout: CONVERSION_TIMEOUT_MS });
  const generated = fs.readdirSync(outputDir)
    .find((name) => name.toLowerCase().endsWith('.pdf'));
  if (!generated) throw new Error('LibreOffice did not create a PDF');
  return path.join(outputDir, generated);
}

async function convertWithMacPowerPoint(
  sourcePath: string,
  outputPath: string,
  run: RunProcess,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const script = `
on run argv
  set sourcePath to item 1 of argv
  set outputPath to item 2 of argv
  set importedDeck to missing value
  try
    tell application "Microsoft PowerPoint"
      set importedDeck to open (POSIX file sourcePath)
      save importedDeck in outputPath as save as PDF
      close importedDeck saving no
    end tell
  on error errorMessage number errorNumber
    try
      tell application "Microsoft PowerPoint" to close importedDeck saving no
    end try
    error errorMessage number errorNumber
  end try
end run`;
  await run('/usr/bin/osascript', ['-e', script, sourcePath, outputPath], { env, timeout: NATIVE_APP_TIMEOUT_MS });
  return outputPath;
}

async function convertWithKeynote(
  sourcePath: string,
  outputPath: string,
  run: RunProcess,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const script = `
on run argv
  set sourcePath to item 1 of argv
  set outputPath to item 2 of argv
  set importedDeck to missing value
  try
    tell application "Keynote"
      set importedDeck to open (POSIX file sourcePath)
      export importedDeck to (POSIX file outputPath) as PDF
      close importedDeck saving no
    end tell
  on error errorMessage number errorNumber
    try
      tell application "Keynote" to close importedDeck saving no
    end try
    error errorMessage number errorNumber
  end try
end run`;
  await run('/usr/bin/osascript', ['-e', script, sourcePath, outputPath], { env, timeout: NATIVE_APP_TIMEOUT_MS });
  return outputPath;
}

async function convertWithWindowsPowerPoint(
  sourcePath: string,
  outputPath: string,
  run: RunProcess,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const script = `
$ErrorActionPreference = 'Stop'
$source = [Environment]::GetEnvironmentVariable('NODUS_PRESENTER_SOURCE')
$output = [Environment]::GetEnvironmentVariable('NODUS_PRESENTER_OUTPUT')
$powerpoint = $null
$deck = $null
try {
  $powerpoint = New-Object -ComObject PowerPoint.Application
  $deck = $powerpoint.Presentations.Open($source, $true, $true, $false)
  $deck.SaveAs($output, 32)
} finally {
  if ($null -ne $deck) { $deck.Close() }
  if ($null -ne $powerpoint) { $powerpoint.Quit() }
  if ($null -ne $deck) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($deck) }
  if ($null -ne $powerpoint) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($powerpoint) }
}`;
  await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    env: { ...env, NODUS_PRESENTER_SOURCE: sourcePath, NODUS_PRESENTER_OUTPUT: outputPath },
    timeout: NATIVE_APP_TIMEOUT_MS,
  });
  return outputPath;
}

function isUsablePdf(filePath: string): boolean {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile() || fs.statSync(filePath).size < 5) return false;
  const fd = fs.openSync(filePath, 'r');
  try {
    const header = Buffer.alloc(5);
    fs.readSync(fd, header, 0, header.length, 0);
    return header.toString('ascii') === '%PDF-';
  } finally {
    fs.closeSync(fd);
  }
}

function runProcess(
  executable: string,
  args: readonly string[],
  options: { env?: NodeJS.ProcessEnv; timeout?: number } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(executable, [...args], {
      env: options.env,
      timeout: options.timeout,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    }, (error) => (error ? reject(error) : resolve()));
  });
}

function removeTemp(tempDir: string): void {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // OS temp cleanup is best-effort; the imported library PDF is already safe.
  }
}
