// Keeping a long walk's app alive across its own death.
//
// A live walk — a hundred questions against a real provider — runs for ten minutes or
// more, and it is not the only process that decides how long it lives: a shell that times
// out, a terminal that closes or a session that restarts signals the walk process, and
// Playwright answers a signal by quitting the Electron app it launched. Issue #892 is what
// that looked like before this module existed: the app went away ninety answers in, every
// remaining question was recorded as a failure, and nothing in the log said whether the app
// had quit, crashed or been killed.
//
// So the app is a *restartable* resource here. The keeper notices the instance is gone,
// launches a replacement through a single-flight gate (three workers seeing the same loss
// must not each launch an app), re-asks the question that was in flight, and gives up only
// after a bounded number of relaunches so a build that cannot stay up fails loudly instead
// of looping forever.

/** The first line of a Playwright error: its message, not the browser log it appends. */
export function lossReason(error) {
  return (error instanceof Error ? error.message : String(error)).split('\n')[0].trim();
}

/**
 * @param {object} options
 * @param {number} options.limit        how many replacement instances the walk may launch
 * @param {() => boolean} options.isUp  whether the current instance can answer
 * @param {() => Promise<unknown>} options.launch  brings up a fresh instance
 * @param {() => Promise<void>} options.close      best-effort teardown of the old one
 * @param {(message: string) => void} options.log
 */
export function createInstanceKeeper({ limit, isUp, launch, close, log = () => {} }) {
  const losses = [];
  let relaunches = 0;
  let relaunching = null;
  let recorded = false;

  /** The state probe, made unanswerable-proof: a question about a dead instance can fail
   *  in its own right (Playwright's handles throw once their app is gone), and the only
   *  safe reading of "cannot say" is "gone". */
  function instanceUp() {
    try {
      return !!isUp();
    } catch {
      return false;
    }
  }

  /** One loss per instance, however many workers noticed it. */
  function noteLoss(error) {
    if (recorded) return;
    recorded = true;
    losses.push(lossReason(error));
    log(`the app went away (${losses.at(-1)}); answers in flight are re-asked on a fresh instance`);
  }

  /** A live instance, launching a replacement when the walk lost the last one. */
  async function ensure() {
    if (instanceUp()) return;
    if (!relaunching) {
      relaunching = (async () => {
        if (relaunches >= limit) {
          throw new Error(`the app went away ${losses.length} times and was relaunched ${relaunches} — this walk needs a human`);
        }
        await close();
        relaunches++;
        await launch();
        recorded = false;
        log(`fresh app for the rest of the walk (relaunch ${relaunches}/${limit})`);
      })().finally(() => { relaunching = null; });
    }
    await relaunching;
  }

  /**
   * Run one question, surviving an instance that dies under it.
   *
   * A lost instance is not the question's failure: it is asked again on the app that
   * replaces it. The state decides, not the wording — a killed app can surface as an
   * internal Playwright error ("Cannot read properties of undefined") just as easily as a
   * closed target, and either way no answer arrived. What is left to the caller is a
   * failure while the instance is demonstrably up, because retrying that would spin; the
   * exception is "Target crashed", which is the page itself saying it is gone before its
   * crash event has necessarily landed.
   */
  async function ask(call) {
    for (;;) {
      await ensure();
      try {
        return await call();
      } catch (error) {
        if (instanceUp() && !String(error).includes('Target crashed')) throw error;
        noteLoss(error);
      }
    }
  }

  return {
    ask,
    ensure,
    losses,
    /** How many replacement instances have been launched so far. */
    get relaunches() { return relaunches; },
    /** Whether the instance answered and is still there — for reporting, not for control. */
    get isUp() { return instanceUp(); },
  };
}
