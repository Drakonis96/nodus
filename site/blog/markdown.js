/*
SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
SPDX-License-Identifier: AGPL-3.0-only

A small Markdown renderer for the blog. It covers exactly what posts/_template.md
promises — headings, emphasis, code, links, images, quotes, lists, rules, tables
and fenced code — and nothing else.

Text is HTML-escaped before any inline markup is applied, so a post can never
inject markup by accident.
*/
(function () {
  'use strict';

  const escapeHtml = (value) => value.replace(/[&<>"]/g, (character) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[character]
  ));

  const slugify = (value) => value
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60) || 'section';

  /* Inline markup, applied to already-escaped text. Code spans are pulled out
     first so their contents are never treated as markup. */
  function inline(text) {
    const codes = [];
    let out = escapeHtml(text).replace(/`([^`]+)`/g, (match, code) => {
      codes.push(code);
      // NUL cannot appear in a post, so nothing in the prose can collide with it
      return `\u0000${codes.length - 1}\u0000`;
    });

    out = out
      .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
        (match, alt, src, title) => `<img src="${src}" alt="${alt}"${title ? ` title="${title}"` : ''} loading="lazy"/>`)
      .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (match, label, href, title) => {
        const external = /^https?:/i.test(href);
        return `<a href="${href}"${title ? ` title="${title}"` : ''}${external ? ' target="_blank" rel="noopener"' : ''}>${label}</a>`;
      })
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
      .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');

    // the code span was escaped before capture, so it must not be escaped twice
    return out.replace(/\u0000(\d+)\u0000/g, (match, index) => `<code>${codes[Number(index)]}</code>`);
  }

  function render(source) {
    const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
    const html = [];
    const headings = [];
    let index = 0;

    const isBlank = (line) => !line || !line.trim();

    while (index < lines.length) {
      const line = lines[index];

      if (isBlank(line)) { index++; continue; }

      // fenced code
      const fence = line.match(/^```\s*([\w-]*)\s*$/);
      if (fence) {
        const body = [];
        index++;
        while (index < lines.length && !/^```\s*$/.test(lines[index])) body.push(lines[index++]);
        index++; // closing fence
        const language = fence[1] ? ` class="language-${fence[1]}"` : '';
        html.push(`<pre><code${language}>${escapeHtml(body.join('\n'))}</code></pre>`);
        continue;
      }

      // heading
      const heading = line.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        const level = Math.max(2, heading[1].length); // h1 belongs to the page, not the post
        const text = heading[2].trim();
        const id = slugify(text);
        if (level <= 3) headings.push({ level, text, id });
        html.push(`<h${level} id="${id}">${inline(text)}</h${level}>`);
        index++;
        continue;
      }

      // horizontal rule
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
        html.push('<hr/>');
        index++;
        continue;
      }

      // table: a header row, a divider row, then body rows
      if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[index + 1] || '')) {
        const cells = (row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
        const head = cells(line);
        index += 2;
        const body = [];
        while (index < lines.length && /^\s*\|.*\|\s*$/.test(lines[index])) body.push(cells(lines[index++]));
        html.push(`<table><thead><tr>${head.map((cell) => `<th>${inline(cell)}</th>`).join('')}</tr></thead>`
          + `<tbody>${body.map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
        continue;
      }

      // blockquote
      if (/^\s*>/.test(line)) {
        const body = [];
        while (index < lines.length && /^\s*>/.test(lines[index])) {
          body.push(lines[index++].replace(/^\s*>\s?/, ''));
        }
        html.push(`<blockquote>${render(body.join('\n')).html}</blockquote>`);
        continue;
      }

      // list, ordered or not
      const bullet = line.match(/^\s*([-*+]|\d+\.)\s+/);
      if (bullet) {
        const ordered = /\d/.test(bullet[1]);
        const items = [];
        while (index < lines.length) {
          const item = lines[index].match(/^\s*(?:[-*+]|\d+\.)\s+(.*)$/);
          if (!item) {
            // a wrapped continuation line belongs to the item above it
            if (items.length && !isBlank(lines[index]) && /^\s{2,}\S/.test(lines[index])) {
              items[items.length - 1] += `\n${lines[index].trim()}`;
              index++;
              continue;
            }
            break;
          }
          items.push(item[1]);
          index++;
        }
        const tag = ordered ? 'ol' : 'ul';
        html.push(`<${tag}>${items.map((item) => `<li>${inline(item)}</li>`).join('')}</${tag}>`);
        continue;
      }

      // paragraph: everything up to the next blank line or block starter
      const paragraph = [];
      while (index < lines.length && !isBlank(lines[index])
        && !/^(#{1,6}\s|```|\s*>|\s*([-*+]|\d+\.)\s)/.test(lines[index])
        && !/^\s*([-*_])(\s*\1){2,}\s*$/.test(lines[index])) {
        paragraph.push(lines[index++]);
      }
      if (paragraph.length) html.push(`<p>${inline(paragraph.join('\n'))}</p>`);
      else index++;
    }

    return { html: html.join('\n'), headings };
  }

  window.NodusMarkdown = { render, escapeHtml };
})();
