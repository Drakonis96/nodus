/**
 * Process-level safety net for the main process.
 *
 * Node >= 15 terminates the process on an unhandled rejection. Nodus runs a lot
 * of fire-and-forget work on timers (auto-backup every 30 min, calendar
 * reminders every 30 s, scheduled update checks, scan-queue batches), so a
 * single rejected promise deep inside any of them would take the whole app
 * down — losing whatever the user had open, with no dialog and no log.
 *
 * Installing these handlers makes both cases non-fatal. That is the right
 * trade for a local-first desktop app: an auto-backup that fails is a problem
 * to report, not a reason to kill the editor the user is typing in.
 *
 * Swallowing errors silently would just trade a crash for a mystery, so every
 * fault is logged with its stack. Repeats are collapsed because the failures
 * these handlers catch are typically periodic — a broken 30 s timer would
 * otherwise write the same stack to the log forever.
 */

type FaultKind = 'unhandledRejection' | 'uncaughtException';

/** Collapse identical repeat faults, but keep reporting at a decaying rate. */
const seen = new Map<string, number>();
let installed = false;

function describe(error: unknown): { message: string; stack: string } {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack ?? error.message };
  }
  // Rejections frequently carry a non-Error (a string, or an IPC payload).
  let rendered: string;
  try {
    rendered = typeof error === 'string' ? error : JSON.stringify(error);
  } catch {
    rendered = String(error);
  }
  return { message: rendered, stack: rendered };
}

/**
 * True the 1st, 2nd, 4th, 8th... time a given fault is seen, so a timer that
 * fails on every tick reports early and then fades instead of flooding.
 */
function shouldReport(key: string): boolean {
  const count = (seen.get(key) ?? 0) + 1;
  seen.set(key, count);
  return (count & (count - 1)) === 0;
}

function report(kind: FaultKind, error: unknown): void {
  const { message, stack } = describe(error);
  // Key on the first stack frame so the same fault from the same site collapses
  // while the same message from a different site stays visible.
  const key = `${kind}:${stack.split('\n').slice(0, 2).join('|')}`;
  const count = (seen.get(key) ?? 0) + 1;
  if (!shouldReport(key)) return;
  const repeat = count > 1 ? ` (x${count})` : '';
  console.error(`[fault] ${kind}${repeat}: ${message}\n${stack}`);
}

/**
 * Install the handlers. Safe to call more than once; only the first call binds.
 * Call this as early as possible — before the DB is opened and before any
 * timer is scheduled — so startup faults are covered too.
 */
export function installProcessSafetyNet(): void {
  if (installed) return;
  installed = true;

  process.on('unhandledRejection', (reason) => report('unhandledRejection', reason));
  process.on('uncaughtException', (error) => report('uncaughtException', error));
}

/** Test seam: forget the collapse history so repeat-throttling is observable. */
export function resetProcessSafetyNetForTests(): void {
  seen.clear();
}
