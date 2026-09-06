// Minimal browser interfaces keep the main-process build free of global DOM types.
// The sanitizer runs in the renderer or inside an isolated SVG inspection window.
interface SvgNode {
  localName: string; textContent: string | null;
  attributes: ArrayLike<{ name: string; value: string }>;
  querySelectorAll(selector: string): ArrayLike<SvgNode>;
  remove(): void; removeAttribute(name: string): void; setAttribute(name: string, value: string): void;
}
interface SvgDocument { documentElement: SvgNode; querySelector(selector: string): SvgNode | null }
interface SvgDom {
  DOMParser: new () => { parseFromString(source: string, type: string): SvgDocument };
  XMLSerializer: new () => { serializeToString(document: SvgDocument): string };
}

/** Static SVG allowlist. Even sanitized SVG is rendered as an image, never live DOM. */
export function sanitizeChatSvg(source: string): { svg: string; title: string } | null {
  if (source.length > 300_000 || /<!DOCTYPE|<!ENTITY/i.test(source)) return null;
  const dom = globalThis as unknown as SvgDom;
  const doc = new dom.DOMParser().parseFromString(source, 'image/svg+xml');
  if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg') return null;
  const allowed = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'title', 'desc', 'defs', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'marker', 'use', 'style']);
  const safeCss = (value: string) => !/@|expression|javascript:|https?:|data:|\/\/|\\|behavior|binding/i.test(value)
    && [...value.matchAll(/url\s*\(([^)]*)\)/gi)].every(match => /^['"]?#[\w.-]+['"]?$/.test(match[1].trim()));
  for (const element of [doc.documentElement, ...Array.from(doc.documentElement.querySelectorAll('*'))]) {
    if (!allowed.has(element.localName)) { element.remove(); continue; }
    if (element.localName === 'style' && !safeCss(element.textContent ?? '')) { element.remove(); continue; }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value;
      if (name.startsWith('on') || name === 'src' || name === 'xml:base'
        || (name.endsWith('href') && !/^#[\w.-]+$/.test(value))
        || ((name === 'style' || /url\s*\(/i.test(value)) && !safeCss(value))) element.removeAttribute(attribute.name);
    }
  }
  doc.documentElement.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return { svg: new dom.XMLSerializer().serializeToString(doc), title: doc.querySelector('title')?.textContent?.trim() || 'SVG Studio' };
}

export function svgImageUrl(svg: string): string {
  const bytes = new TextEncoder().encode(svg);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}
