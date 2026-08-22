import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { importGlobalLibraryFiles } from '../library/libraryService';
import { TOOLKIT_REGISTRY } from '../toolkit/convert';
import { makeToolkitTmpDir, runToolkitJob } from '../toolkit/toolkitJobs';
import type { ToolkitJobRequest, ToolkitOpId } from '@shared/toolkitTypes';
import { fetchWithTimeout } from './serverSyncShared';

interface RemoteOperation {
  opId: ToolkitOpId;
  inputExtension: string;
  outputFormat: string;
  options: Record<string, string | number | boolean>;
}

/** The complete remote Toolkit vocabulary. Adding a Desktop operation is a code change, not a
 * payload trick: mobile can never select an IPC channel, executable, local path or output root. */
const REMOTE_TOOLKIT_OPERATIONS: Readonly<Record<string, RemoteOperation>> = Object.freeze({
  'docx-to-text': { opId: 'docx-to-text', inputExtension: 'docx', outputFormat: 'md', options: {} },
  'ocr-pdf-searchable': { opId: 'ocr-pdf-searchable', inputExtension: 'pdf', outputFormat: 'pdf', options: { languages: 'spa+eng' } },
});

function digest(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }
function safeFileName(value: unknown, index: number, extension: string): string {
  const candidate = typeof value === 'string' ? path.basename(value).replace(/[^A-Za-z0-9._ -]/g, '-').slice(0, 160) : '';
  return candidate && candidate !== '.' && candidate !== '..' ? candidate : `mobile-input-${index + 1}.${extension}`;
}

/** Download account-scoped objects, run a bounded local operation and import only its outputs
 * into the account-global Library. The result contains Library ids—not Desktop paths. */
export async function executeRemoteToolkitAction(
  payload: Record<string, unknown>, base: string, token: string,
): Promise<{ operation: string; libraryItemIds: string[]; created: number; skipped: number; warnings: string[] }> {
  const operationName = typeof payload.operation === 'string' ? payload.operation : '';
  const operation = REMOTE_TOOLKIT_OPERATIONS[operationName];
  if (!operation) throw new Error('toolkit_operation_refused');
  if (payload.outputFormat !== operation.outputFormat) throw new Error('toolkit_output_refused');
  const hashes = Array.isArray(payload.libraryObjectIds) ? payload.libraryObjectIds : [];
  if (hashes.length < 1 || hashes.length > 8 || hashes.some((value) => typeof value !== 'string' || !/^[0-9a-f]{64}$/i.test(value))) {
    throw new Error('bad_library_object_ids');
  }
  const fileNames = Array.isArray(payload.fileNames) ? payload.fileNames : [];
  if (fileNames.length && (fileNames.length !== hashes.length || fileNames.some((value) => typeof value !== 'string'))) {
    throw new Error('bad_file_names');
  }

  const temporary = makeToolkitTmpDir();
  const inputDirectory = path.join(temporary, 'input');
  const outputDirectory = path.join(temporary, 'output');
  fs.mkdirSync(inputDirectory, { recursive: true }); fs.mkdirSync(outputDirectory, { recursive: true });
  try {
    const inputPaths: string[] = [];
    let totalBytes = 0;
    for (let index = 0; index < hashes.length; index += 1) {
      const hash = hashes[index] as string;
      const response = await fetchWithTimeout(`${base}/api/v1/library/objects/${hash}`, { headers: { authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error(`library_object_get_${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      totalBytes += bytes.length;
      if (bytes.length > 100 * 1024 * 1024 || totalBytes > 250 * 1024 * 1024) throw new Error('toolkit_input_too_large');
      if (digest(bytes) !== hash) throw new Error('library_object_hash_mismatch');
      const file = path.join(inputDirectory, `${index + 1}-${safeFileName(fileNames[index], index, operation.inputExtension)}`);
      fs.writeFileSync(file, bytes, { flag: 'wx' }); inputPaths.push(file);
    }
    const request: ToolkitJobRequest = {
      opId: operation.opId, inputPaths, outputFormat: operation.outputFormat, options: operation.options,
      outputDir: outputDirectory, mergedName: null, zipOutput: false, zipName: null, openFolderOnDone: false,
    };
    const result = await runToolkitJob(`mobile-${randomUUID()}`, request, TOOLKIT_REGISTRY);
    const outputPaths = result.files.flatMap((file) => file.outputPaths);
    if (result.cancelled || outputPaths.length < 1 || result.files.some((file) => file.status === 'error')) throw new Error('toolkit_job_failed');
    const imported = await importGlobalLibraryFiles(outputPaths);
    return { operation: operationName, libraryItemIds: imported.itemIds, created: imported.created, skipped: imported.skipped, warnings: imported.warnings };
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

export const REMOTE_TOOLKIT_ACTION_KINDS = Object.freeze(Object.keys(REMOTE_TOOLKIT_OPERATIONS));
