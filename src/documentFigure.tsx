import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { CapabilityView } from './components/CapabilityView';
import { validateViewDocument } from '../packages/capability-api/src/views';
import './components/capabilityPackages.css';
import './components/chatVisuals.css';
import './components/documentFigures.css';

/** No privileged preload. Only the validated, explicitly supplied attachment bytes are
 * visible in this isolated export window. This uses the production node renderers. */
const root = createRoot(document.getElementById('root')!);
Object.assign(window, { renderDocumentFigure: async (input: { view: unknown; owner: string; assets: Record<string, { base64: string; mimeType: string }> }) => {
  const read = async (source: string) => {
    const prefix = `nodus-capability://chat/${input.owner}/`;
    const asset = source.startsWith(prefix) && input.assets[source.slice(prefix.length)];
    if (!asset) throw new Error('Missing figure attachment.');
    return { bytes: Uint8Array.from(atob(asset.base64), char => char.charCodeAt(0)), mimeType: asset.mimeType };
  };
  window.nodus = { readCapabilityMedia: read, readCapabilityModel: read } as unknown as typeof window.nodus;
  const view = validateViewDocument(input.view);
  flushSync(() => root.render(<div id="figure" className="document-snapshot"><CapabilityView view={view} owner={input.owner} presentation="snapshot" /></div>));
  await document.fonts.ready;
  const deadline = Date.now() + 30_000;
  let ready = false;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 80));
    if (document.querySelector('[data-state="failed"], [role="alert"]')) throw new Error('A figure asset failed to render.');
    const models = Array.from(document.querySelectorAll('.capability-view-model'));
    const images = Array.from(document.images);
    if (models.every(element => element.getAttribute('data-state') === 'ready') && images.every(image => image.complete && image.naturalWidth > 0)
      && document.querySelectorAll('.capability-view-image').length <= images.length) { ready = true; break; }
  }
  if (!ready) throw new Error('A figure asset did not finish loading.');
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const element = document.getElementById('figure')!;
  const rect = element.getBoundingClientRect();
  if (rect.height < 10 || rect.height > 2200 || element.scrollWidth > element.clientWidth + 2 || document.querySelector('.capability-view-model[data-state="loading"]')) throw new Error('The figure exceeds the printable layout.');
  return { x: Math.floor(rect.x), y: Math.floor(rect.y), width: Math.ceil(rect.width), height: Math.ceil(rect.height) };
} });
