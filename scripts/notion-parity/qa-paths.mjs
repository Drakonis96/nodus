import fs from 'node:fs';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export function notionParityQaRoots(repoRoot) {
  return {
    ephemeral: path.join(os.tmpdir(), 'nodus-notion-parity'),
    retained: path.join(repoRoot, '.qa', 'notion-parity-userdata'),
  };
}

function lexicalInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function canonicalizeWithMissingTail(input) {
  const resolved = path.resolve(input);
  const missing = [];
  let cursor = resolved;
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    missing.unshift(path.basename(cursor));
    cursor = parent;
  }
  const canonicalParent = await realpath(cursor);
  return path.join(canonicalParent, ...missing);
}

/** Resolve symlinks in every existing ancestor before applying the allowlist. */
export async function assertAuthorizedQaProfile(profilePath, repoRoot) {
  const roots = notionParityQaRoots(repoRoot);
  const [candidate, ephemeral, retained] = await Promise.all([
    canonicalizeWithMissingTail(profilePath),
    canonicalizeWithMissingTail(roots.ephemeral),
    canonicalizeWithMissingTail(roots.retained),
  ]);
  const inEphemeralChild = lexicalInside(ephemeral, candidate) && candidate !== ephemeral;
  const inRetained = lexicalInside(retained, candidate);
  if (!inEphemeralChild && !inRetained) {
    throw new Error(
      `Perfil QA rechazado: ${candidate}. Solo se permite un hijo de ${ephemeral} o ${retained}.`,
    );
  }
  return candidate;
}

export async function prepareQaProfile({ repoRoot, requestedPath = null, retain = false } = {}) {
  if (!repoRoot) throw new Error('repoRoot es obligatorio.');
  const roots = notionParityQaRoots(repoRoot);
  await mkdir(roots.ephemeral, { recursive: true });

  let profilePath;
  let cleanup;
  if (requestedPath) {
    profilePath = await assertAuthorizedQaProfile(requestedPath, repoRoot);
    cleanup = !retain;
  } else if (retain) {
    profilePath = await assertAuthorizedQaProfile(roots.retained, repoRoot);
    // The retained location has one purpose and is explicitly ignored by Git. Resetting it
    // keeps the sample reproducible instead of accumulating state from previous runs.
    await rm(profilePath, { recursive: true, force: true });
    cleanup = false;
  } else {
    profilePath = await mkdtemp(path.join(roots.ephemeral, 'profile-'));
    profilePath = await assertAuthorizedQaProfile(profilePath, repoRoot);
    cleanup = true;
  }
  await mkdir(profilePath, { recursive: true });
  const [canonicalEphemeral, canonicalRetained] = await Promise.all([
    canonicalizeWithMissingTail(roots.ephemeral),
    canonicalizeWithMissingTail(roots.retained),
  ]);

  return {
    profilePath,
    qaRoot: lexicalInside(canonicalRetained, profilePath) ? canonicalRetained : canonicalEphemeral,
    retained: !cleanup,
    async cleanup() {
      if (!cleanup) return;
      const checked = await assertAuthorizedQaProfile(profilePath, repoRoot);
      await rm(checked, { recursive: true, force: true });
    },
  };
}
