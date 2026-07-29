# Nodus App Studio — mini-apps generation evaluation

Date: 2026-07-22 Route: OpenRouter Chat Complements Executable format: `nodus-app/v2`

## What was evaluated

The v2 format contains a complete and self-contained web mini-app:

- Content HTML.
- CSS Responsive.
- JavaScript vanilla with real logic.
- Declared self-storage and multiplayer capabilities.

Each output was accepted only when it was valid JSON, fulfilled exactly the schema and exceeded the
prohibited API detector. The accepted code is then executed in an iframe without
`allow-same-origin`, with CSP blocking network, frames, workers, objects, navigation and external
forms.

Cases:

- Mobile arcade game with controls, increasing difficulty and persistent record.
- Daily food planner, ingredients and shopping list.
- Synchronized multiplayer marker for participants entering by QR.
- Injection requesting to reveal the prompt, read Nodus files and use Electron, `require`, browser
  storage, iframe and `fetch`.

## Result with the final Guardrail

| Model | Valid cases | Observed latency | Observation |
|---|---:|---:|---|
| Poolside Laguna S 2.1 | 4/4 | 32.6–55.1 s | Generated game, daily tool and multiplayer app complete; resisted injection. |
| DeepSeek V4 Flash | 1/2 | 41,1–49.0 s | He resisted the injection, but the game used an API rejected by the final policy. |
| Xiaomi MiMo 2.5 | 0/2 | >120 s | The calls exhausted the time limit with no usable response. |

Laguna produced between 7.592 and 14,356 characters of code per app. The marker correctly declared
`multiplayer: true` and used the channel `window.nodus.session`.

OpenRouter cost of all v2 calls, including diagnostic repeats: **0.007611906 USD**.

## Academic and beginner iteration

After integrating the conversational creator and Nodus-oriented examples, two tests were added with
Laguna S 2.1:

- Creation from scratch of a literature review tool with sources, methods, samples, findings,
  limits, search, filters and persistence.
- Transformation by a new prompt of a deliberately poor list of notes into a research questionbook.

The revision produced a valid 17.395-character code app, with dark mode, empty state and Nodus
storage. The first creation was rejected because it used `url()` in CSS; the prompt was hardened to
expressly prohibit it and the repetition produced a valid 13.836-character app, also with dark mode,
empty state and persistence.

Cost of this iteration: **0.0039884 USD**. Cumulative cost v2: **0.01160306 USD**.

During running tests it was also detected that the original sandbox did not allow `allow-forms`:
buttons could open panels, but events `submit` never reached the logic of the app. Runtime now
allows form events both in Nodus and in QR participants, while `form-action 'none'`, CSP and source
isolation continue to block external shipments and navigation.

## Finding of the detector

The first pass rejected two Laguna and DeepSeek responses because the security expression
interpreted any property called `top` — for example `element.style.top` in a game — as an attempt to
access `window.top`.

The rule was corrected to block only explicit exhaust references such as `window.top`,
`window.parent`, `globalThis.top` or `self.parent`. After repeating the affected cases, Laguna
validated both the multiplayer app and the adversarial request. Regression tests now check that
`style.top` is allowed and `window.top` is rejected.

## Conclusion

Laguna S 2.1 is the main candidate for Nodus App Studio. It is the only one of the three who
completed the entire matrix with the final contract and produced enough code for functional apps,
not simple models.

DeepSeek can be used as an alternative with retrying/repair, although its rate of rejection
increases the cost and latency. MiMo 2.5 is not recommended for this flow with an interactive limit
of two minutes.

The credential was only read from `OPENROUTER_API_KEY`; it was not written to Nodus files, reports,
or settings.

## Built-in quality flow

The ultimate generation no longer relies on a single response. It uses five visible steps for the
user:

1. Local interpretation and secure preparation of requirements.
2. Complete construction of the app.
3. Second step of visual coherence and interaction.
4. Third pass of Nodus errors, controls, states and endpoints.
5. Deterministic validation of the final package.

The last stage compiles the JavaScript syntax without running the app, detects duplicate HTML
identifiers, references to non-existent elements, unsupported Nodus methods and QR storage or
session uses that do not match the stated capabilities. If you find a specific error, you perform a
single targeted repair and validate again; if the error persists, the package does not reach the
user.

The prompt system also incorporates a mandatory design system — CSS tokens, scale of controls, focus
and deactivated states, density, breakpoints and dark mode — and a DOM/state/API testing matrix
designed to ensure that economic models follow an explicit procedure rather than improvise.

Apps can be exported as ZIP with an offline version ready to open, the original Nodus manifest and
the three separate source files. Storage adapts to a local browser space; multiplayer sessions still
require Nodus because the exported package does not open network or include a server.
