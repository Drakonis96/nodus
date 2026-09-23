import fs from 'node:fs';
import path from 'node:path';

export const ISOLATED_PROFILE_FORMAT = 'nodus.isolated-research-profile/1';

/** No app, database, preferences or secret-store imports belong in this module. */
export function validateIsolatedRoot(root: string): string {
  if (!path.isAbsolute(root)) throw new Error('Isolated profile requires an absolute root');
  const resolved = fs.realpathSync(root);
  const marker = JSON.parse(fs.readFileSync(path.join(resolved, 'isolation.json'), 'utf8'));
  if (marker.format !== ISOLATED_PROFILE_FORMAT || marker.root !== resolved) {
    throw new Error('Invalid isolated profile manifest');
  }
  if (resolved === path.parse(resolved).root) throw new Error('Invalid isolated profile root');
  return resolved;
}

export function isolatedPath(root: string, relative: string): string {
  const destination = path.resolve(root, relative);
  if (!destination.startsWith(`${root}${path.sep}`)) throw new Error('Path leaves isolated profile');
  // Check every existing ancestor before creating anything, including dangling symlinks.
  let current = root;
  for (const segment of path.relative(root, destination).split(path.sep)) {
    current = path.join(current, segment);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Symlinks are forbidden in isolated profile paths');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  return destination;
}
