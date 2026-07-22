import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { ModelRef } from '@shared/types';
import type {
  TranslateHistoryEntry,
  TranslateInputKind,
  TranslateOutputFormat,
  TranslatePdfMode,
} from '@shared/toolkitTranslateTypes';

const MAX_HISTORY_ENTRIES = 250;

type StoredTranslateHistoryEntry = Omit<TranslateHistoryEntry, 'outputExists'>;

export interface AddTranslateHistoryInput {
  inputKind: TranslateInputKind;
  sourceLabel: string;
  sourcePath: string | null;
  targetLanguage: string;
  targetLanguageLabel: string;
  model: ModelRef;
  pdfMode: TranslatePdfMode | null;
  outputPath: string | null;
  format: Exclude<TranslateOutputFormat, 'same'> | null;
  pageCount?: number;
  overflowPages?: number[];
  warnings?: string[];
  translatedText?: string | null;
}

function historyFile(baseDir?: string): string {
  const root = baseDir ?? app.getPath('userData');
  return path.join(root, 'toolkit', 'translate', 'history.json');
}

function readStored(baseDir?: string): StoredTranslateHistoryEntry[] {
  const file = historyFile(baseDir);
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? parsed.filter((entry) => entry && typeof entry.id === 'string') : [];
  } catch {
    return [];
  }
}

function writeStored(entries: StoredTranslateHistoryEntry[], baseDir?: string): void {
  const file = historyFile(baseDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(entries.slice(0, MAX_HISTORY_ENTRIES), null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, file);
}

function hydrate(entry: StoredTranslateHistoryEntry): TranslateHistoryEntry {
  return {
    ...entry,
    outputExists: Boolean(entry.outputPath && fs.existsSync(entry.outputPath)),
  };
}

export function listTranslateHistory(baseDir?: string): TranslateHistoryEntry[] {
  return readStored(baseDir).map(hydrate);
}

export function addTranslateHistory(input: AddTranslateHistoryInput, baseDir?: string): TranslateHistoryEntry {
  const entry: StoredTranslateHistoryEntry = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    inputKind: input.inputKind,
    sourceLabel: input.sourceLabel,
    sourcePath: input.sourcePath,
    targetLanguage: input.targetLanguage,
    targetLanguageLabel: input.targetLanguageLabel,
    model: input.model,
    pdfMode: input.pdfMode,
    outputPath: input.outputPath,
    format: input.format,
    pageCount: input.pageCount,
    overflowPages: input.overflowPages ?? [],
    warnings: input.warnings ?? [],
    translatedText: input.translatedText ?? null,
  };
  writeStored([entry, ...readStored(baseDir)], baseDir);
  return hydrate(entry);
}

export function removeTranslateHistory(id: string, baseDir?: string): TranslateHistoryEntry[] {
  writeStored(readStored(baseDir).filter((entry) => entry.id !== id), baseDir);
  return listTranslateHistory(baseDir);
}
