<?xml version="1.0" encoding="UTF-8"?>
<!--
SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
SPDX-License-Identifier: AGPL-3.0-only

Browsers stopped rendering RSS years ago, so anyone who clicks the feed link
lands on raw XML. This stylesheet gives that page a readable face. Feed readers
ignore it entirely: it only ever runs in a browser.
-->
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:atom="http://www.w3.org/2005/Atom">
  <xsl:output method="html" encoding="UTF-8" indent="yes"/>

  <xsl:template match="/rss/channel">
    <html lang="en">
      <head>
        <meta charset="utf-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <meta name="robots" content="noindex"/>
        <title><xsl:value-of select="title"/> — RSS feed</title>
        <link rel="icon" type="image/svg+xml" href="../assets/nodus-logo.svg"/>
        <style>
          :root {
            --void: #06050b;
            --raised: #100d1c;
            --membrane: rgba(255, 255, 255, 0.09);
            --ink: #f6f4fd;
            --ink-2: #a9a3c2;
            --ink-3: #6f6a86;
            --accent: #c084fc;
          }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            padding: clamp(28px, 6vw, 72px) 20px clamp(48px, 8vw, 96px);
            background:
              radial-gradient(900px 520px at 12% -10%, rgba(192, 132, 252, 0.16), transparent 68%),
              var(--void);
            color: var(--ink);
            font: 400 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, Helvetica, Arial, sans-serif;
            -webkit-font-smoothing: antialiased;
          }
          .wrap { max-width: 820px; margin: 0 auto; }
          a { color: var(--accent); text-decoration: none; }
          a:hover { text-decoration: underline; }
          .brand {
            display: inline-flex; align-items: center; gap: 9px;
            font-size: 14px; font-weight: 600; color: var(--ink-2);
            letter-spacing: 0.02em;
          }
          .brand img { width: 22px; height: 22px; }
          h1 {
            margin: 22px 0 10px;
            font-size: clamp(28px, 5vw, 42px);
            letter-spacing: -0.03em; line-height: 1.12;
          }
          .lead { margin: 0; max-width: 60ch; color: var(--ink-2); }
          .note {
            margin: 30px 0 0; padding: 22px 24px;
            border: 1px solid var(--membrane); border-radius: 16px;
            background: linear-gradient(180deg, rgba(34, 22, 54, 0.7), rgba(12, 9, 22, 0.6));
          }
          .note h2 {
            margin: 0 0 8px; font-size: 13px; font-weight: 700;
            letter-spacing: 0.09em; text-transform: uppercase; color: var(--accent);
          }
          .note p { margin: 0 0 14px; color: var(--ink-2); font-size: 15px; }
          .note p:last-child { margin-bottom: 0; }
          .url {
            display: block; width: 100%; padding: 12px 14px;
            border: 1px solid var(--membrane); border-radius: 10px;
            background: rgba(255, 255, 255, 0.04);
            color: var(--ink); font: 500 14px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
            word-break: break-all;
          }
          .items { margin-top: 42px; display: grid; gap: 14px; }
          .items h2.section {
            margin: 0; font-size: 13px; font-weight: 700;
            letter-spacing: 0.09em; text-transform: uppercase; color: var(--ink-3);
          }
          .item {
            padding: 24px 26px;
            border: 1px solid var(--membrane); border-radius: 16px;
            background: linear-gradient(180deg, rgba(23, 19, 40, 0.82), rgba(11, 9, 21, 0.78));
          }
          .item .date {
            font: 600 12px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
            letter-spacing: 0.05em; text-transform: uppercase; color: var(--ink-3);
          }
          .item h3 { margin: 12px 0 8px; font-size: clamp(19px, 2.4vw, 24px); letter-spacing: -0.02em; }
          .item h3 a { color: var(--ink); }
          .item h3 a:hover { color: var(--accent); text-decoration: none; }
          .item p { margin: 0; color: var(--ink-2); font-size: 15px; }
          .tags { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 16px; }
          .tags span {
            padding: 4px 11px; border-radius: 999px;
            border: 1px solid var(--membrane); background: rgba(255, 255, 255, 0.045);
            font-size: 11.5px; font-weight: 600; color: var(--ink-3);
          }
          .foot { margin-top: 40px; font-size: 14px; color: var(--ink-3); }
        </style>
      </head>
      <body>
        <div class="wrap">
          <a class="brand" href="{link}">
            <img src="../assets/nodus-logo.svg" alt=""/>
            <xsl:text>Nodus</xsl:text>
          </a>

          <h1><xsl:value-of select="title"/></h1>
          <p class="lead"><xsl:value-of select="description"/></p>

          <div class="note">
            <h2>This page is an RSS feed</h2>
            <p>
              It is meant for a feed reader, not for a browser. Paste the address below into
              Feedly, NetNewsWire, Reeder, Thunderbird or whatever you use, and every new post
              will arrive there on its own.
            </p>
            <code class="url"><xsl:value-of select="atom:link/@href"/></code>
            <p style="margin-top:14px">
              <xsl:text>Prefer to read in the browser? </xsl:text>
              <a href="{link}">Open the blog instead.</a>
            </p>
          </div>

          <div class="items">
            <h2 class="section">
              <xsl:value-of select="count(item)"/>
              <xsl:text> post</xsl:text>
              <xsl:if test="count(item) != 1">s</xsl:if>
              <xsl:text> in this feed</xsl:text>
            </h2>
            <xsl:apply-templates select="item"/>
          </div>

          <p class="foot">Nodus — a free, open-source, local-first workspace for research, teaching and study.</p>
        </div>
      </body>
    </html>
  </xsl:template>

  <xsl:template match="item">
    <div class="item">
      <div class="date"><xsl:value-of select="substring(pubDate, 6, 11)"/></div>
      <h3><a href="{link}"><xsl:value-of select="title"/></a></h3>
      <p><xsl:value-of select="description"/></p>
      <xsl:if test="category">
        <div class="tags">
          <xsl:for-each select="category">
            <span><xsl:value-of select="."/></span>
          </xsl:for-each>
        </div>
      </xsl:if>
    </div>
  </xsl:template>
</xsl:stylesheet>
