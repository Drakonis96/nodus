import vm from 'node:vm';
import { completeJson } from './aiClient';
import { getSettings } from '../db/settingsRepo';
import {
  auditToolkitAppManifest,
  buildToolkitAppDesignReviewPrompt,
  buildToolkitAppFunctionReviewPrompt,
  buildToolkitAppPrompt,
  isToolkitAppManifest,
  type ToolkitAppGenerationRequest,
  type ToolkitAppGenerationProgress,
  type ToolkitAppGenerationResult,
  type ToolkitAppManifest,
} from '@shared/toolkitApps';

type ProgressHandler = (progress: ToolkitAppGenerationProgress) => void;

function executableIssues(manifest: ToolkitAppManifest): string[] {
  const audit = auditToolkitAppManifest(manifest);
  const issues = [...audit.errors];
  try {
    new vm.Script(`(async()=>{\n${manifest.files.javascript}\n})`, { filename: 'nodus-miniapp.js' });
  } catch (cause) {
    issues.push(`JavaScript syntax error: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  return [...new Set(issues)];
}

async function completeManifest(prompt: { system: string; user: string }, model: NonNullable<ToolkitAppGenerationRequest['model']>): Promise<ToolkitAppManifest> {
  return completeJson<ToolkitAppManifest>(
    {
      system: prompt.system,
      user: prompt.user,
      temperature: 0.15,
      maxTokens: 16_000,
      reasoning: 'off',
      timeoutMs: 180_000,
      plainContext: true,
    },
    isToolkitAppManifest,
    model,
  );
}

/**
 * Generate one sandboxed mini-app bundle through three independent model passes,
 * followed by deterministic syntax/DOM/API checks. A final targeted repair is only
 * billed when those checks still find a concrete executable error.
 */
export async function generateToolkitApp(request: ToolkitAppGenerationRequest, onProgress?: ProgressHandler): Promise<ToolkitAppGenerationResult> {
  if (!request.instruction?.trim()) {
    throw new Error('Describe con tus palabras qué app quieres crear o qué cambio necesitas.');
  }
  if (request.instruction.length > 8000) {
    throw new Error('La descripción es demasiado larga. Resúmela en menos de 8.000 caracteres.');
  }
  if (request.previousManifest && !isToolkitAppManifest(request.previousManifest)) throw new Error('La versión anterior de la app no es válida.');
  const model = request.model ?? getSettings().synthesisModel;
  if (!model) {
    throw new Error('Selecciona primero un modelo de IA en Ajustes o en el creador de Nodus Apps.');
  }
  onProgress?.({ phase: 'planning', current: 1, total: 5 });

  onProgress?.({ phase: 'building', current: 2, total: 5 });
  const draft = await completeManifest(buildToolkitAppPrompt(request), model);

  onProgress?.({ phase: 'design-review', current: 3, total: 5 });
  const designed = await completeManifest(buildToolkitAppDesignReviewPrompt(request, draft), model);

  const designAudit = auditToolkitAppManifest(designed);
  const reviewIssues = [...executableIssues(designed), ...designAudit.warnings];
  onProgress?.({ phase: 'function-review', current: 4, total: 5 });
  let manifest = await completeManifest(buildToolkitAppFunctionReviewPrompt(request, designed, reviewIssues), model);

  onProgress?.({ phase: 'validating', current: 5, total: 5 });
  let remainingIssues = executableIssues(manifest);
  if (remainingIssues.length) {
    onProgress?.({ phase: 'function-review', current: 4, total: 5 });
    manifest = await completeManifest(buildToolkitAppFunctionReviewPrompt(request, manifest, remainingIssues), model);
    onProgress?.({ phase: 'validating', current: 5, total: 5 });
    remainingIssues = executableIssues(manifest);
  }
  if (remainingIssues.length) {
    throw new Error(`La verificación final no pudo garantizar que la app funcionara correctamente: ${remainingIssues.join(' · ')}`);
  }

  const finalAudit = auditToolkitAppManifest(manifest);
  const endpointChecks = finalAudit.endpoints.length ? finalAudit.endpoints : ['sandbox:no-external-endpoints'];
  onProgress?.({ phase: 'complete', current: 5, total: 5 });
  return {
    manifest,
    model,
    quality: {
      designReviewed: true,
      functionalityReviewed: true,
      checks: ['schema', 'javascript-syntax', 'dom-targets', ...endpointChecks],
    },
  };
}
