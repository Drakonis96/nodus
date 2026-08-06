/**
 * The one version number this project has.
 *
 * The desktop, the iOS app and this server ship as one release and carry one number, so that
 * "which version are you on?" has a single answer and a compatibility problem can be named
 * before it is diagnosed. A server on 3.1.0 and a phone on 3.0.4 is a fact worth seeing on
 * screen; two independent version schemes make it invisible.
 *
 * Written out rather than read from `package.json` because this server has no build step and
 * the Dockerfile copies only what it needs — a file that may or may not be in the image is a
 * poor place for a value four routes depend on. `scripts/test-version-agreement.mjs` fails if
 * this drifts from the root `package.json`, from `server/package.json`, or from the two iOS
 * targets in `ios/project.yml`.
 */
export const NODUS_VERSION = '3.2.4';
