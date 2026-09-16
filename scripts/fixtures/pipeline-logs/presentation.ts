// One bundle for the log's presentation and the i18n that feeds it.
//
// `scripts/test-pipeline-logs-i18n.mjs` sets the active interface language and then renders a
// line: with two separate esbuild bundles there would be two module instances and the language
// change would never reach the renderer, so both have to come out of the same entry.
export {
  renderPipelineLogLine,
  renderPipelineLogDetail,
  categoryLabel,
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  LEVEL_ORDER,
  LEVEL_PRESENTATION,
  SCOPE_LABEL,
  entryFieldChips,
  entryIdentityChips,
  logDay,
  logTime,
} from '../../../src/components/pipeline-logs/logPresentation';
export { setActiveLang, t, tx, txIn, getActiveLang } from '../../../src/i18n';
