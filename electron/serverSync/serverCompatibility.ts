// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
// SPDX-License-Identifier: AGPL-3.0-only

export interface RemoteMutationLimits {
  maxMutationBytes: number | null;
  maxMutationBatchBytes: number | null;
  maxMutationBatch: number;
}

export const LEGACY_SERVER_MUTATION_LIMITS: RemoteMutationLimits = {
  maxMutationBytes: null,
  maxMutationBatchBytes: null,
  maxMutationBatch: 100,
};

/** Missing fields are the normal Nodus Server 3.2.7 response, not an incompatibility. */
export function negotiateRemoteMutationLimits(value: unknown): RemoteMutationLimits {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const positive = (candidate: unknown): number | null => (
    typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0 ? candidate : null
  );
  return {
    maxMutationBytes: positive(input.maxMutationBytes),
    maxMutationBatchBytes: positive(input.maxMutationBatchBytes),
    maxMutationBatch: positive(input.maxMutationBatch) ?? LEGACY_SERVER_MUTATION_LIMITS.maxMutationBatch,
  };
}
