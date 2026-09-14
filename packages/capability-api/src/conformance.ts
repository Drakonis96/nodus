import { validateCapabilityManifestV2, type CapabilityManifestV2 } from './manifest';
import { validateViewDocument } from './views';
import { sanitizeProjection, validateWorkerArtifact } from './artifacts';
import { validateFinalMutations, validatePrepareMutations, type ChatAstNode } from './chat';
import { validateSettingsState } from './settings';
import type { CapabilityWorkerV2 } from './worker';

/** Contract fixtures a plugin runs against its own worker, so the package fails its own
 *  `npm test` rather than failing an install. This checks the shape of what a worker
 *  returns, never what it means: only the plugin knows whether ethanol was drawn right. */

export interface ConformanceFinding { check: string; ok: boolean; detail?: string }

export interface ConformanceOptions {
  locale?: string;
  nodusVersion?: string;
  /** One invocation per tool the suite should exercise, with input the worker accepts. */
  invocations?: Array<{ toolId: string; input: unknown }>;
  /** A reply the prepare/finalize hooks should be able to read without throwing. */
  chatNodes?: ChatAstNode[];
  /** One stored artifact per type, so renderArtifact and the projection are exercised. */
  artifacts?: Array<{ artifactType: string; artifactVersion: number; data: unknown }>;
}

export async function runConformanceSuite(
  manifest: CapabilityManifestV2,
  worker: CapabilityWorkerV2,
  options: ConformanceOptions = {},
): Promise<ConformanceFinding[]> {
  const findings: ConformanceFinding[] = [];
  const locale = options.locale ?? 'en';
  const record = async (check: string, run: () => Promise<void> | void) => {
    try { await run(); findings.push({ check, ok: true }); }
    catch (error) { findings.push({ check, ok: false, detail: error instanceof Error ? error.message : String(error) }); }
  };

  await record('manifest validates', () => { validateCapabilityManifestV2(manifest); });

  await record('health reports a status and a data version', async () => {
    const health = await worker.health({ nodusVersion: options.nodusVersion ?? '5.3.2', locale, platform: process.platform, arch: process.arch, dataVersion: 0 });
    if (!['ready', 'degraded', 'needs-setup', 'needs-migration'].includes(health?.status)) throw new Error(`Unexpected health status: ${String(health?.status)}.`);
    if (!Number.isInteger(health.dataVersion) || health.dataVersion < 0) throw new Error('health must report an integer dataVersion.');
  });

  // A declared hook that is not implemented is a manifest lie the host would hit at runtime.
  await record('declared hooks are implemented', () => {
    if (manifest.chat?.hooks.prepare && typeof worker.prepareChat !== 'function') throw new Error('The manifest declares a prepare hook the worker does not implement.');
    if (manifest.chat?.hooks.finalize && typeof worker.finalizeChat !== 'function') throw new Error('The manifest declares a finalize hook the worker does not implement.');
    if (manifest.settings && typeof worker.getSettings !== 'function') throw new Error('The manifest declares settings the worker cannot read.');
    if (manifest.settings?.actions.length && typeof worker.runAction !== 'function') throw new Error('The manifest declares actions the worker cannot run.');
  });

  const context = {
    nodeIds: new Set((options.chatNodes ?? []).map(node => node.id)),
    toolIds: new Set(manifest.tools.map(tool => tool.id)),
    artifactTypes: manifest.artifacts,
  };

  if (options.chatNodes && worker.prepareChat) {
    await record('prepareChat returns valid mutations', async () => {
      validatePrepareMutations(await worker.prepareChat!({ nodes: options.chatNodes!, locale }), context);
    });
  }

  for (const invocation of options.invocations ?? []) {
    const tool = manifest.tools.find(candidate => candidate.id === invocation.toolId);
    await record(`invoke ${invocation.toolId} returns a valid result`, async () => {
      if (!tool) throw new Error(`The manifest declares no tool ${invocation.toolId}.`);
      const result = await worker.invoke({ invocationId: 'conformance', toolId: invocation.toolId, input: invocation.input, locale });
      for (const artifact of result.artifacts ?? []) {
        const validated = validateWorkerArtifact(artifact, manifest.artifacts);
        if (!tool.artifactTypes.includes(validated.artifactType)) throw new Error(`${invocation.toolId} produced ${validated.artifactType}, which it does not declare.`);
      }
      if (result.view) validateViewDocument(result.view);
      for (const notice of result.notices ?? []) validateViewDocument(notice);
    });
  }

  if (options.chatNodes && worker.finalizeChat) {
    await record('finalizeChat returns valid mutations', async () => {
      validateFinalMutations(await worker.finalizeChat!({ nodes: options.chatNodes!, locale }), context);
    });
  }

  for (const artifact of options.artifacts ?? []) {
    const declared = manifest.artifacts.find(entry => entry.type === artifact.artifactType);
    await record(`renderArtifact ${artifact.artifactType} returns a valid view`, async () => {
      if (!declared) throw new Error(`The manifest declares no artifact type ${artifact.artifactType}.`);
      validateViewDocument(await worker.renderArtifact({ ...artifact, locale }));
    });
    await record(`${artifact.artifactType} honours its declared model visibility`, async () => {
      if (!declared) throw new Error(`The manifest declares no artifact type ${artifact.artifactType}.`);
      if (declared.modelVisibility === 'none') {
        if (typeof worker.projectArtifactForModel === 'function') {
          // A `none` type must not have something to project; the core would drop it anyway,
          // and a worker that builds one has misunderstood its own privacy declaration.
          const projection = await worker.projectArtifactForModel({ artifactType: artifact.artifactType, artifactVersion: artifact.artifactVersion, data: artifact.data }).catch(() => null);
          if (projection) throw new Error(`${artifact.artifactType} declares modelVisibility "none" but produced a projection.`);
        }
        return;
      }
      if (typeof worker.projectArtifactForModel !== 'function') throw new Error(`${artifact.artifactType} declares a projection the worker cannot produce.`);
      sanitizeProjection(await worker.projectArtifactForModel({ artifactType: artifact.artifactType, artifactVersion: artifact.artifactVersion, data: artifact.data }));
    });
  }

  if (manifest.settings && worker.getSettings) {
    await record('getSettings never reports a stored secret', async () => {
      validateSettingsState(await worker.getSettings!(), manifest.settings!);
    });
  }

  await record('shutdown resolves', async () => { await worker.shutdown(); });
  return findings;
}

export const conformanceFailures = (findings: readonly ConformanceFinding[]): ConformanceFinding[] => findings.filter(finding => !finding.ok);
