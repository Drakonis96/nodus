import type { Session } from 'electron';
// Ephemeral extension runtimes never belong to the privileged application UI.
const untrusted = new WeakSet<Session>();
export function registerUntrustedSession(session: Session) { untrusted.add(session); }
export function isUntrustedSession(session: Session) { return untrusted.has(session); }
