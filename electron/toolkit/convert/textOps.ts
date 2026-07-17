// Nodus Toolkit — text utilities (category E). The string transforms are the pure
// functions in shared/toolkitText.ts; this module wires them into operations and
// adds the byte-level one (checksums). Electron-free: only node builtins + the
// shared pure module, so it bundles cleanly for unit tests.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { cleanPastedPdfText, changeCase, subtitlesToText } from '@shared/toolkitText';
import type { ToolkitOpRegistry, ToolkitRunContext } from '../toolkitJobs';
import type { ToolkitProduced } from '@shared/toolkitTypes';

const enc = new TextEncoder();
const readText = (input: string): string => fs.readFileSync(input, 'utf8');

function cleanOp(input: string, ctx: ToolkitRunContext): ToolkitProduced[] {
  ctx.onPageProgress(1);
  return [{ data: enc.encode(cleanPastedPdfText(readText(input))), ext: 'txt', suffix: ' (limpio)' }];
}

function caseOp(input: string, ctx: ToolkitRunContext): ToolkitProduced[] {
  const mode = String(ctx.options.mode ?? 'sentence') as 'sentence' | 'title' | 'upper' | 'lower';
  ctx.onPageProgress(1);
  return [{ data: enc.encode(changeCase(readText(input), mode)), ext: 'txt', suffix: ` (${mode})` }];
}

function subtitlesOp(input: string, ctx: ToolkitRunContext): ToolkitProduced[] {
  ctx.onPageProgress(1);
  return [{ data: enc.encode(subtitlesToText(readText(input))), ext: 'txt' }];
}

/** E4 — SHA-256 / MD5 of a file, byte-exact (hashes raw bytes, not decoded text). */
function checksumOp(input: string, ctx: ToolkitRunContext): ToolkitProduced[] {
  const algorithm = String(ctx.options.algorithm ?? 'sha256');
  const data = fs.readFileSync(input);
  const hash = (algo: string) => crypto.createHash(algo).update(data).digest('hex');
  const lines: string[] = [];
  if (algorithm === 'sha256' || algorithm === 'both') lines.push(`SHA-256  ${hash('sha256')}`);
  if (algorithm === 'md5' || algorithm === 'both') lines.push(`MD5      ${hash('md5')}`);
  ctx.onPageProgress(1);
  return [{ data: enc.encode(lines.join('\n') + '\n'), ext: 'txt', suffix: ' (checksums)' }];
}

export const textOps: ToolkitOpRegistry = {
  'text-clean-pdf-paste': { arity: 'each', run: async ([input], ctx) => cleanOp(input, ctx) },
  'text-change-case': { arity: 'each', run: async ([input], ctx) => caseOp(input, ctx) },
  'subtitles-to-txt': { arity: 'each', run: async ([input], ctx) => subtitlesOp(input, ctx) },
  'file-checksum': { arity: 'each', run: async ([input], ctx) => checksumOp(input, ctx) },
};
