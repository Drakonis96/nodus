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

/** Electron honors XDG_CONFIG_HOME on Linux before our bootstrap runs. The
 * harness's exact private config path is already isolated, not production.
 * Check the OS account home independently of the overridden HOME variable. */
export function assertIsolatedProductionSeparation(root: string, appData: string, systemHome: string, platform: NodeJS.Platform): void {
  const dataRoots = [appData];
  if (platform === 'linux') {
    if (path.resolve(appData) === path.join(root, 'profile', 'config')) dataRoots.length = 0;
    dataRoots.push(path.join(systemHome, '.config'));
  }
  for (const dataRoot of dataRoots) for (const name of ['Nodus', 'nodus']) {
    const production = path.resolve(dataRoot, name);
    if (root === production || root.startsWith(`${production}${path.sep}`)
      || production.startsWith(`${root}${path.sep}`)) throw new Error('Test root overlaps production');
  }
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

/** Chromium's macOS singleton creates sockets in the system temp directory,
 * outside the test write boundary. Hold a private exclusive lock instead. A
 * stale test profile fails closed and can be discarded by its owning harness. */
export function claimIsolatedProfile(root: string): (() => void) | null {
  const file = path.join(isolatedPath(validateIsolatedRoot(root), 'profile'), 'isolated-instance.lock');
  let fd: number;
  try { fd = fs.openSync(file, 'wx', 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return null;
    throw error;
  }
  fs.writeFileSync(fd, String(process.pid));
  let released = false;
  return () => {
    if (released) return;
    released = true;
    fs.closeSync(fd);
    fs.unlinkSync(file);
  };
}
