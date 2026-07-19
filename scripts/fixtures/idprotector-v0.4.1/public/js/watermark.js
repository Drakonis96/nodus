/* IDprotector — watermark rendering (100% client-side).
 * Draws a configurable, tiled watermark onto a 2D canvas context.
 * No network, no storage — pure pixels. */
(function (global) {
  "use strict";

  var SL = global.SL || (global.SL = {});

  SL.BRAND = "IDprotector";
  SL.VERSION = "v0.4.1";

  // Available patterns (id + human label). Order defines UI order.
  SL.PATTERNS = [
    { id: "dense",       label: "Seguro" },
    { id: "topographic", label: "Topográfico" },
    { id: "diagonal",    label: "Diagonal" },
    { id: "mesh",        label: "Malla" },
    { id: "grid",        label: "Rejilla" },
    { id: "single",      label: "Central" },
    { id: "manual",      label: "Manual" }
  ];

  SL.SWATCHES = ["#111111", "#e0362a", "#1d6fd6", "#178a4c", "#7a3ff2", "#8a8a8a"];

  SL.defaultWatermark = function () {
    return {
      enabled: true,
      text: "",
      pattern: "dense",
      opacity: 0.18,   // 0..1
      size: 22,        // font px, relative to a 1000px-wide reference
      color: "#111111",
      footer: true,
      // Manual mode holds one or more independent, draggable stamps. Each item
      // has its own text (empty = falls back to the shared text), position and
      // angle. randomizePerPage scatters them so multi-page/-image documents
      // don't carry the stamp in the exact same spot on every page.
      manual: {
        items: [{ text: "", x: 0.5, y: 0.82, angle: 0 }],
        randomizePerPage: false
      }
    };
  };

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function frac(v) { return v - Math.floor(v); }

  // Deterministic per-page/-item position jitter (normalised units). Page 0
  // keeps the placed position (offset 0) so the drag on the first page lands
  // exactly where expected; later pages get a stable pseudo-random shift so the
  // watermark isn't stuck in the same spot across a whole document. Shared with
  // the app so the live preview and the exported file always agree.
  SL.manualPageOffset = function (pageIndex, itemIndex) {
    var p = pageIndex || 0;
    var i = (itemIndex || 0) + 1;
    if (!p) return { x: 0, y: 0 };
    var AMP = 0.17;
    var rx = frac(Math.sin(p * 73.13 + i * 19.19) * 43758.5453) * 2 - 1;
    var ry = frac(Math.sin(p * 11.71 + i * 97.37) * 15731.743) * 2 - 1;
    return { x: rx * AMP, y: ry * AMP };
  };

  function tr(key, fallback) {
    return typeof SL.t === "function" ? SL.t(key, fallback) : fallback;
  }

  // Draw rows of repeated text at a given angle across the whole canvas.
  function tile(ctx, w, h, opts) {
    var angle = opts.angle * Math.PI / 180;
    var fontPx = opts.fontPx;
    var diag = Math.sqrt(w * w + h * h);

    ctx.save();
    ctx.globalAlpha = opts.alpha;
    ctx.fillStyle = opts.color;
    ctx.font = "600 " + fontPx + "px Georgia, 'Times New Roman', serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";

    ctx.translate(w / 2, h / 2);
    ctx.rotate(angle);

    var sep = opts.diamonds ? "   ◆   " : "      ";
    var unit = opts.text + sep;
    var unitW = Math.max(ctx.measureText(unit).width, 1);
    var lineH = fontPx * opts.lineFactor;

    var reps = Math.ceil((diag * 1.4) / unitW) + 2;
    var row = "";
    for (var i = 0; i < reps; i++) row += unit;
    var rowW = ctx.measureText(row).width;

    var amp = opts.wave ? fontPx * 0.42 : 0;
    var waveK = 2 * Math.PI / (fontPx * 5.5);

    var rowIndex = 0;
    for (var y = -diag; y <= diag; y += lineH) {
      var offset = (rowIndex % 2 === 0) ? 0 : unitW / 2;
      if (opts.wave) {
        drawWavyRow(ctx, row, -rowW / 2 - offset, y, amp, waveK, rowIndex * 1.3);
      } else {
        ctx.fillText(row, -rowW / 2 - offset, y);
      }
      rowIndex++;
    }
    ctx.restore();
  }

  // Draw a row of text following a sine curve for the densest pattern.
  function drawWavyRow(ctx, text, x0, y0, amp, k, phase) {
    var penX = x0;
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      var cw = ctx.measureText(ch).width;
      var cx = penX + cw / 2;
      var yy = y0 + amp * Math.sin(cx * k + phase);
      var slope = Math.atan(amp * k * Math.cos(cx * k + phase));
      ctx.save();
      ctx.translate(cx, yy);
      ctx.rotate(slope);
      ctx.fillText(ch, -cw / 2, 0);
      ctx.restore();
      penX += cw;
    }
  }

  // Draw a row of text whose baseline follows a 2D "height field", so
  // consecutive rows curve together into flowing topographic-style contours.
  function drawFieldRow(ctx, text, x0, rowY, field) {
    var penX = x0;
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      var cw = ctx.measureText(ch).width;
      var cx = penX + cw / 2;
      var yy = field(cx, rowY);
      var slope = Math.atan2(field(cx + 4, rowY) - field(cx - 4, rowY), 8);
      ctx.save();
      ctx.translate(cx, yy);
      ctx.rotate(slope);
      ctx.fillText(ch, -cw / 2, 0);
      ctx.restore();
      penX += cw;
    }
  }

  // Dense repeated text flowing along interwoven contour lines, mimicking the
  // guilloché / "valid only for background check" security print of an ID.
  function topographic(ctx, w, h, opts) {
    var fontPx = opts.fontPx;
    var diag = Math.sqrt(w * w + h * h);

    // A smooth height field summing a few sines. Dependence on both x and the
    // row's y makes neighbouring rows share the wave, forming contour bands.
    function fieldFor(A1, A2, A3, phase) {
      var k1 = 2 * Math.PI / (fontPx * 14);
      var k2 = 2 * Math.PI / (fontPx * 24);
      var k3 = 2 * Math.PI / (fontPx * 40);
      var ky1 = 2 * Math.PI / (fontPx * 20);
      var ky2 = 2 * Math.PI / (fontPx * 34);
      return function (x, rowY) {
        return rowY
          + A1 * Math.sin(x * k1 + rowY * ky1 + phase)
          + A2 * Math.sin(x * k2 - rowY * ky2 + phase * 1.7)
          + A3 * Math.cos((x * 0.7 + rowY * 1.6) * k3 + phase);
      };
    }

    function pass(angle, lineH, rowOffset, fontScale, alpha, field) {
      var fs = fontPx * fontScale;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = opts.color;
      ctx.font = "600 " + fs + "px Georgia, 'Times New Roman', serif";
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      ctx.translate(w / 2, h / 2);
      ctx.rotate(angle * Math.PI / 180);
      var unit = opts.text + "  ◆  ";
      var unitW = Math.max(ctx.measureText(unit).width, 1);
      var reps = Math.ceil((diag * 1.6) / unitW) + 2;
      var row = "";
      for (var i = 0; i < reps; i++) row += unit;
      var rowW = ctx.measureText(row).width;
      for (var y = -diag; y <= diag; y += lineH) {
        var offset = rowOffset ? unitW / 2 : 0;
        drawFieldRow(ctx, row, -rowW / 2 - offset, y, field);
      }
      ctx.restore();
    }

    var lineH = fontPx * 1.5;
    // Main contour print, plus a finer half-offset pass that fills the gaps for
    // the dense, hard-to-remove look of the reference document.
    pass(-12, lineH, false, 1, opts.alpha, fieldFor(fontPx * 0.66, fontPx * 0.34, fontPx * 0.20, 0));
    pass(-12, lineH, true, 0.7, opts.alpha * 0.5, fieldFor(fontPx * 0.58, fontPx * 0.30, fontPx * 0.18, 1.9));
  }

  // Draw one big centred diagonal line of text, scaled to fit.
  function single(ctx, w, h, opts) {
    var diag = Math.sqrt(w * w + h * h);
    ctx.save();
    ctx.globalAlpha = opts.alpha;
    ctx.fillStyle = opts.color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.translate(w / 2, h / 2);
    ctx.rotate(-Math.PI / 6);
    var fs = opts.fontPx * 3.2;
    ctx.font = "700 " + fs + "px Georgia, serif";
    var guard = 0;
    while (ctx.measureText(opts.text).width > diag * 0.86 && fs > 8 && guard++ < 200) {
      fs -= 2;
      ctx.font = "700 " + fs + "px Georgia, serif";
    }
    ctx.fillText(opts.text, 0, 0);
    ctx.restore();
  }

  function manualItems(wm) {
    var m = wm.manual || {};
    var items = Array.isArray(m.items) ? m.items : null;
    if (!items || !items.length) {
      // Tolerate the legacy single-stamp shape / missing data.
      items = [{
        text: "",
        x: typeof m.x === "number" ? m.x : 0.5,
        y: typeof m.y === "number" ? m.y : 0.82,
        angle: typeof m.angle === "number" ? m.angle : 0
      }];
    }
    return items;
  }

  function drawManualStamp(ctx, w, h, x, y, angle, text, opts) {
    var fs = opts.fontPx * 1.55;
    var maxW = w * 0.84;
    ctx.save();
    ctx.globalAlpha = opts.alpha;
    ctx.fillStyle = opts.color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.translate(x * w, y * h);
    ctx.rotate(angle);
    ctx.font = "700 " + fs + "px Georgia, serif";
    var guard = 0;
    while (ctx.measureText(text).width > maxW && fs > 8 && guard++ < 200) {
      fs -= 1;
      ctx.font = "700 " + fs + "px Georgia, serif";
    }
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  function manual(ctx, w, h, wm, opts, pageIndex) {
    var items = manualItems(wm);
    var randomize = !!(wm.manual && wm.manual.randomizePerPage);
    items.forEach(function (item, idx) {
      var x = clamp(typeof item.x === "number" ? item.x : 0.5, 0.03, 0.97);
      var y = clamp(typeof item.y === "number" ? item.y : 0.82, 0.03, 0.97);
      if (randomize) {
        var off = SL.manualPageOffset(pageIndex, idx);
        x = clamp(x + off.x, 0.03, 0.97);
        y = clamp(y + off.y, 0.03, 0.97);
      }
      var angle = clamp(typeof item.angle === "number" ? item.angle : 0, -60, 60) * Math.PI / 180;
      var text = (item.text && item.text.trim()) ? item.text.trim() : opts.text;
      drawManualStamp(ctx, w, h, x, y, angle, text, opts);
    });
  }

  /**
   * Render the watermark onto ctx covering (w x h) pixels.
   * wm: watermark state object. `scale` maps the reference size to actual px
   * so a preview and a full-res export look identical.
   */
  SL.renderWatermark = function (ctx, w, h, wm, scale, pageIndex) {
    if (!wm || !wm.enabled) return;
    var text = (wm.text && wm.text.trim()) ? wm.text.trim() : tr("watermark.unauthorized", "SIN AUTORIZAR");
    scale = scale || 1;
    var fontPx = Math.max(6, wm.size * scale);
    var color = wm.color || "#111111";
    var a = Math.min(0.95, Math.max(0.02, wm.opacity));

    var base = { text: text, color: color, fontPx: fontPx };

    switch (wm.pattern) {
      case "single":
        single(ctx, w, h, { text: text, color: color, alpha: a, fontPx: fontPx });
        break;
      case "manual":
        manual(ctx, w, h, wm, { text: text, color: color, alpha: a, fontPx: fontPx }, pageIndex);
        break;
      case "topographic":
        topographic(ctx, w, h, { text: text, color: color, alpha: a, fontPx: fontPx });
        break;
      case "grid":
        tile(ctx, w, h, Object.assign({}, base, { angle: 0, alpha: a, diamonds: false, lineFactor: 2.6 }));
        break;
      case "mesh":
        tile(ctx, w, h, Object.assign({}, base, { angle: -28, alpha: a * 0.8, diamonds: false, lineFactor: 2.4 }));
        tile(ctx, w, h, Object.assign({}, base, { angle: 28, alpha: a * 0.8, diamonds: false, lineFactor: 2.4 }));
        break;
      case "diagonal":
        tile(ctx, w, h, Object.assign({}, base, { angle: -30, alpha: a, diamonds: true, lineFactor: 2.3 }));
        break;
      case "dense":
      default:
        // Busy, multi-directional pattern with curved rows.
        tile(ctx, w, h, Object.assign({}, base, { angle: -30, alpha: a, diamonds: true, lineFactor: 1.9, wave: true }));
        tile(ctx, w, h, Object.assign({}, base, { angle: 22, alpha: a * 0.62, fontPx: fontPx * 0.82, diamonds: true, lineFactor: 2.5, wave: true }));
        tile(ctx, w, h, Object.assign({}, base, { angle: 0, alpha: a * 0.5, fontPx: fontPx * 0.7, diamonds: false, lineFactor: 3.1, wave: true }));
        break;
    }

    if (wm.footer) drawFooter(ctx, w, h, scale, color);
  };

  function drawFooter(ctx, w, h, scale, color) {
    var pad = 14 * scale;
    var fs = Math.max(9, 12 * scale);
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = color;
    ctx.textBaseline = "alphabetic";
    ctx.font = "italic " + fs + "px Georgia, serif";
    ctx.textAlign = "left";
    ctx.fillText(tr("watermark.protectedWith", "Protegido con") + " " + SL.BRAND, pad, h - pad);
    ctx.textAlign = "right";
    ctx.globalAlpha = 0.65;
    ctx.font = fs + "px Georgia, serif";
    ctx.fillText(SL.VERSION, w - pad, h - pad);
    ctx.restore();
  }

  // Small standalone thumbnail used by the pattern picker.
  SL.renderThumb = function (canvas, patternId, color) {
    var ctx = canvas.getContext("2d");
    var w = canvas.width, hgt = canvas.height;
    ctx.clearRect(0, 0, w, hgt);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, hgt);
    SL.renderWatermark(ctx, w, hgt, {
      enabled: true, text: "ID", pattern: patternId,
      opacity: 0.55, size: 7, color: color || "#111111", footer: false,
      manual: { x: 0.5, y: 0.68, angle: 0 }
    }, 1);
  };

})(window);
