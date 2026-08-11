const pkg = require('../package.json');

const channel = process.env.NODUS_RELEASE_CHANNEL;
if (channel !== 'latest' && channel !== 'beta') {
  throw new Error(`NODUS_RELEASE_CHANNEL must be "latest" or "beta"; received ${JSON.stringify(channel)}`);
}

// Keep one packaging definition. The release workflow only overrides the feed
// channel, which GitHub publishing cannot infer reliably from a prerelease tag.
module.exports = {
  ...pkg.build,
  publish: pkg.build.publish.map((target) => ({ ...target, channel })),
};
