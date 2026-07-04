import { BrowserWindow } from 'electron';

// ─────────────────────────────────────────────────────────────────────────────
// Shared Markdown → HTML / PDF rendering used by both project and writing-workshop
// exports. Keeps `nodus://` citations readable (label kept, url listed at the end)
// and renders through an offscreen BrowserWindow so PDFs match on-screen typography.
// ─────────────────────────────────────────────────────────────────────────────

export function stripMarkdownLinks(text: string): string {
  return text.replace(/\[([^\]]+)\]\((nodus:\/\/[^)]+)\)/g, '$1');
}

export function stripInlineMarkdown(text: string): string {
  return stripMarkdownLinks(text).replace(/[*_`]/g, '');
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** All distinct `nodus://` citations in the document, in first-seen order. */
export function collectCitations(markdown: string): { label: string; url: string }[] {
  const out: { label: string; url: string }[] = [];
  const seen = new Set<string>();
  const re = /\[([^\]]+)\]\(nodus:\/\/(idea|work|gap|contradiction|passage)\/([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(markdown)) !== null) {
    const id = decodeURIComponent(match[3]);
    const url = `nodus://${match[2]}/${encodeURIComponent(id)}`;
    const key = `${match[2]}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label: stripInlineMarkdown(match[1]), url });
  }
  return out;
}

function inlineHtml(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((nodus:\/\/[^)]+)\)/g, (_full, label: string, url: string) =>
      `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`
    );
}

export function markdownToHtml(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const out: string[] = [];
  let paragraph: string[] = [];
  let inList = false;
  const flushParagraph = () => {
    if (paragraph.length) {
      out.push(`<p>${inlineHtml(paragraph.join(' '))}</p>`);
      paragraph = [];
    }
  };
  const closeList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };
  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (!line.trim()) {
      flushParagraph();
      closeList();
      continue;
    }
    if (heading) {
      flushParagraph();
      closeList();
      const level = Math.min(6, heading[1].length);
      out.push(`<h${level}>${inlineHtml(heading[2])}</h${level}>`);
      continue;
    }
    if (bullet) {
      flushParagraph();
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${inlineHtml(bullet[1])}</li>`);
      continue;
    }
    closeList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  closeList();
  const refs = collectCitations(markdown);
  if (refs.length) {
    out.push('<h1>Bibliografia Nodus</h1>', '<ul>');
    for (const ref of refs) out.push(`<li>${escapeHtml(ref.label)} - ${escapeHtml(ref.url)}</li>`);
    out.push('</ul>');
  }
  return out.join('\n');
}

function renderHtml(markdown: string, title: string): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font: 12pt Georgia, serif; line-height: 1.55; color: #171717; margin: 42px; }
    h1, h2, h3 { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.2; }
    h1 { font-size: 24pt; margin-top: 0; }
    h2 { font-size: 17pt; margin-top: 28px; }
    h3 { font-size: 14pt; margin-top: 22px; }
    a { color: #1f4fbf; text-decoration: none; }
    blockquote { margin-left: 0; padding-left: 14px; border-left: 3px solid #bbb; color: #444; }
  </style>
</head>
<body>${markdownToHtml(markdown)}</body>
</html>`;
}

export async function markdownToPdf(markdown: string, title: string): Promise<Buffer> {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(renderHtml(markdown, title))}`);
    return await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
  } finally {
    win.destroy();
  }
}
