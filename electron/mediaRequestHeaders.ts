import type { WebRequest } from 'electron';
import { TUTORIAL_VIDEO_EMBED_ORIGIN } from '@shared/tutorialVideos';

/** Electron keeps only the last listener for each webRequest event. Register the
 * YouTube and map rules together so neither silently replaces the other. */
export function installMediaRequestHeaders(webRequest: Pick<WebRequest, 'onBeforeSendHeaders'>, version: string): void {
  webRequest.onBeforeSendHeaders(
    { urls: [`${TUTORIAL_VIDEO_EMBED_ORIGIN}/*`, '*://*.tile.openstreetmap.org/*'] },
    (details, callback) => {
      const headers = { ...details.requestHeaders };
      const url = new URL(details.url);
      if (url.origin === TUTORIAL_VIDEO_EMBED_ORIGIN) {
        headers.Referer = 'https://nodusresearch.com/';
      } else if ((url.protocol === 'http:' || url.protocol === 'https:')
        && (url.hostname === 'tile.openstreetmap.org' || url.hostname.endsWith('.tile.openstreetmap.org'))) {
        headers['User-Agent'] = `Nodus/${version} (+https://nodusresearch.com)`;
        headers.Referer = 'https://nodusresearch.com/';
      }
      callback({ requestHeaders: headers });
    },
  );
}
