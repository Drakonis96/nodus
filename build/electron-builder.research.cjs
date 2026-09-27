// A higher version exists only in disposable installer validation. Source/public
// package versions and update feeds remain untouched; publishing stays disabled.
const release = require('./electron-builder.release.cjs');
const version = process.env.NODUS_RESEARCH_CANDIDATE_VERSION;
if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted'
    || !/^5\.6\.1-research\.\d+$/.test(version ?? '')) {
  throw new Error('Research candidates require a disposable hosted runner and explicit test version');
}
module.exports = { ...release, extraMetadata: { ...release.extraMetadata, version }, publish: null };
