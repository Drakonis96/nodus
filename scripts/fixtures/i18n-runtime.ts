// The renderer's i18n surface, for the tests that assert runtime prose is translated.
//
// One bundle, one module instance: `setActiveLang` here has to be the same module the `tr()`
// under test reads, or the language switch never reaches it.
export { errorText, getActiveLang, setActiveLang, t, tr, tx, txIn, resolveTranslation } from '../../src/i18n';
