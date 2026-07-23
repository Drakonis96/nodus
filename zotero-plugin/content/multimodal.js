/* Nodus for Zotero — visual page capture and structured OCR/figure analysis.
 * The pure helpers are unit-tested; reader access is best-effort because Zotero
 * does not yet expose page bitmaps through a stable public API.
 */
/* eslint-disable no-undef */
(function () {
  "use strict";

  const MAX_IMAGE_DIM = 1800;
  const MAX_IMAGES = 6;
  const VISUAL_SYSTEM = [
    "You are the visual extraction stage of an academic evidence system.",
    "Inspect the supplied document page image. Transcribe meaningful text and represent non-text content faithfully.",
    "Use only these labels, one record per line:",
    "[OCR] visible prose or labels",
    "[FIGURE] caption, axes, legend, salient values and relationship",
    "[TABLE] headers and rows in compact Markdown",
    "[FORMULA] exact formula in LaTeX, then define visible symbols",
    "[DIAGRAM] nodes, directed connections, groups and labels",
    "Do not infer facts that are not visible. If the page has no useful content, return [OCR] EMPTY.",
  ].join("\n");

  function isImageDataUrl(value) {
    return /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(String(value || ""));
  }
  function dataUrlToImagePart(value) {
    const s = String(value || "");
    const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/i.exec(s);
    if (!m) throw new Error("invalid-image-data-url");
    return { mimeType: m[1].toLowerCase(), data: m[2].replace(/\s+/g, "") };
  }
  function visualSignals(text) {
    const s = String(text || "");
    return {
      figure: /\b(fig(?:ure)?|figura|gr[aá]fic[oa]|chart)\s*[.:]?\s*\d+/i.test(s),
      table: /\b(table|tabla)\s*[.:]?\s*\d+/i.test(s),
      formula: /(?:=|≤|≥|∑|∫|√|α|β|γ|λ|μ|σ|math|equation|ecuaci[oó]n)/i.test(s),
      diagram: /\b(diagram|diagrama|flowchart|esquema|architecture|arquitectura)\b/i.test(s),
    };
  }
  function needsVisualAnalysis(page) {
    if (!page) return false;
    if (page.needsOcr) return true;
    const signals = visualSignals([page.text, page.visualText].filter(Boolean).join("\n"));
    return Object.values(signals).some(Boolean);
  }

  function readerInternals(reader) {
    try {
      const primary = reader && reader._internalReader && reader._internalReader._primaryView;
      const iframe = primary && primary._iframeWindow;
      const app = iframe && iframe.PDFViewerApplication;
      const viewer = app && app.pdfViewer;
      return { primary, iframe, app, viewer };
    } catch (e) { return {}; }
  }
  function currentPageIndex(reader) {
    const { viewer } = readerInternals(reader);
    if (viewer && Number.isFinite(Number(viewer.currentPageNumber))) return Math.max(0, Number(viewer.currentPageNumber) - 1);
    try {
      const loc = reader && reader._internalReader && reader._internalReader._state && reader._internalReader._state.location;
      if (loc && Number.isFinite(Number(loc.pageIndex))) return Number(loc.pageIndex);
    } catch (e) {}
    return 0;
  }
  function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
  async function renderedCanvas(reader, pageIndex) {
    const { viewer } = readerInternals(reader);
    if (!viewer) throw new Error("pdf-renderer-unavailable");
    const original = currentPageIndex(reader);
    if (pageIndex !== original) {
      try { reader.navigate({ pageIndex }); } catch (e) { viewer.currentPageNumber = pageIndex + 1; }
    }
    let canvas = null;
    for (let attempt = 0; attempt < 30; attempt++) {
      const pageView = viewer.getPageView && viewer.getPageView(pageIndex);
      canvas = pageView && pageView.canvas;
      if (canvas && canvas.width > 10 && canvas.height > 10) break;
      await wait(100);
    }
    if (!canvas) throw new Error("page-canvas-unavailable");
    return { canvas, original };
  }
  function copyCanvas(source, crop, maxDimension) {
    const sx = crop ? Math.max(0, Math.round(crop.x || 0)) : 0;
    const sy = crop ? Math.max(0, Math.round(crop.y || 0)) : 0;
    const sw = crop ? Math.min(source.width - sx, Math.max(1, Math.round(crop.width || source.width))) : source.width;
    const sh = crop ? Math.min(source.height - sy, Math.max(1, Math.round(crop.height || source.height))) : source.height;
    const cap = Number(maxDimension) || MAX_IMAGE_DIM;
    const scale = Math.min(1, cap / Math.max(sw, sh));
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(sw * scale));
    out.height = Math.max(1, Math.round(sh * scale));
    const ctx = out.getContext("2d", { alpha: false });
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, out.width, out.height);
    return out;
  }
  async function capturePage(reader, pageIndex, opts) {
    opts = opts || {};
    const got = await renderedCanvas(reader, Number(pageIndex) || 0);
    const copy = copyCanvas(got.canvas, opts.crop || null, opts.maxDimension);
    const dataUrl = copy.toDataURL("image/jpeg", opts.quality || 0.88);
    if (opts.restore !== false && got.original !== pageIndex) {
      try { reader.navigate({ pageIndex: got.original }); } catch (e) {}
    }
    return {
      pageIndex: Number(pageIndex) || 0,
      dataUrl,
      width: copy.width,
      height: copy.height,
      kind: opts.kind || "page",
    };
  }
  function selectionCrop(selectionDraft, pageIndex, canvas) {
    const pos = selectionDraft && selectionDraft.position;
    if (!pos || Number(pos.pageIndex) !== Number(pageIndex) || !Array.isArray(pos.rects) || !pos.rects.length || !canvas) return null;
    const rects = pos.rects;
    const x1 = Math.min(...rects.map((r) => Number(r[0]) || 0));
    const y1 = Math.min(...rects.map((r) => Number(r[1]) || 0));
    const x2 = Math.max(...rects.map((r) => Number(r[2]) || 0));
    const y2 = Math.max(...rects.map((r) => Number(r[3]) || 0));
    if (!(x2 > x1 && y2 > y1)) return null;
    const pad = 30;
    return { x: Math.max(0, x1 - pad), y: Math.max(0, y1 - pad), width: Math.min(canvas.width, x2 - x1 + 2 * pad), height: Math.min(canvas.height, y2 - y1 + 2 * pad) };
  }
  function visualPrompt(pageLabel, pageText) {
    return `Document page ${pageLabel || "?"}. Existing extraction (possibly incomplete):\n"""\n${String(pageText || "").slice(0, 12000)}\n"""\n\nExtract the visual evidence using the required labels.`;
  }
  function cleanVisualExtraction(value) {
    const lines = String(value || "").replace(/```(?:markdown|text)?/gi, "").replace(/```/g, "").split(/\r?\n/);
    return lines.map((line) => line.trimEnd()).filter((line) => line.trim() && !/^\[OCR\]\s*EMPTY\s*$/i.test(line)).join("\n").trim();
  }

  window.NodusMultimodal = {
    MAX_IMAGE_DIM, MAX_IMAGES, VISUAL_SYSTEM,
    isImageDataUrl, dataUrlToImagePart, visualSignals, needsVisualAnalysis,
    readerInternals, currentPageIndex, renderedCanvas, copyCanvas, capturePage,
    selectionCrop, visualPrompt, cleanVisualExtraction,
  };
})();
