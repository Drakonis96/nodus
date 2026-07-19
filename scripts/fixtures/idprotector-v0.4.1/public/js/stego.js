/* IDprotector — invisible traceable mark (LSB steganography) + PNG text chunks.
 * 100% client-side: no network, no storage — pure bytes and Web Crypto.
 *
 * A traceable copy hides a fixed 24-byte record ("IDPS" v1) in the least
 * significant bit of every R/G/B channel, repeated cyclically across the whole
 * image so it survives cropping (any strip of rows >= 64 px wide keeps whole
 * records). The record carries a random 8-byte copyId authenticated with a
 * truncated HMAC-SHA256. Without a passphrase the HMAC key is a public
 * constant ("open mark": proves the mark is an IDprotector mark, not who made
 * it). With a passphrase the key is derived via PBKDF2 with a FIXED public
 * salt — required because the app keeps no storage and the verifier must
 * re-derive the same key. A fixed salt allows precomputation against weak
 * passphrases; acceptable here, the mark authenticates provenance, it does
 * not encrypt anything.
 *
 * The mark only survives lossless pixels (PNG / PNG-in-PDF). JPEG re-saves,
 * screenshots and rescaling destroy it — the verify UI must say "no mark
 * detected", never "not protected". */
(function (global) {
  "use strict";

  var SL = global.SL || (global.SL = {});

  var MAGIC = new Uint8Array([0x49, 0x44, 0x50, 0x53]); // "IDPS"
  var FORMAT_VERSION = 0x01;
  var RECORD_BYTES = 24;
  var RECORD_BITS = RECORD_BYTES * 8; // 192
  var HEADER_BYTES = 14;              // magic + version + flags + copyId
  var MAC_BYTES = 10;
  var FLAG_PASSPHRASE = 0x01;
  var OPEN_KEY_STR = "idprotector-open-mark-v1";
  var PBKDF2_SALT_STR = "idprotector-stego-salt-v1";
  var PBKDF2_ITER = 310000;
  var MAX_CANDIDATES = 4096;

  var subtle = global.crypto && global.crypto.subtle;
  var available = !!(global.crypto && global.crypto.getRandomValues && subtle);

  /* ---------------------------------------------------------------- *
   * CRC32 — shared by the PNG chunk writer here and the ZIP writer in
   * app.js (hoisted from there so there is a single table).
   * ---------------------------------------------------------------- */
  var CRC_TABLE = (function () {
    var t = [];
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    var crc = 0 ^ (-1);
    for (var i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xFF];
    return (crc ^ (-1)) >>> 0;
  }

  /* ---------------------------------------------------------------- *
   * Byte helpers
   * ---------------------------------------------------------------- */
  function toHex(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
    return s;
  }
  function utf8(str) { return new TextEncoder().encode(str); }
  function bytesEq(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function randomCopyId() {
    var id = new Uint8Array(8);
    global.crypto.getRandomValues(id);
    return id;
  }

  /* ---------------------------------------------------------------- *
   * Keys + HMAC (async, Web Crypto)
   * ---------------------------------------------------------------- */
  function importHmacKey(rawBytes) {
    return subtle.importKey("raw", rawBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  }

  // passphrase "" or null -> open (public constant) key.
  function deriveKey(passphrase) {
    if (!passphrase) return importHmacKey(utf8(OPEN_KEY_STR));
    return subtle.importKey("raw", utf8(passphrase), "PBKDF2", false, ["deriveKey"])
      .then(function (base) {
        return subtle.deriveKey(
          { name: "PBKDF2", salt: utf8(PBKDF2_SALT_STR), iterations: PBKDF2_ITER, hash: "SHA-256" },
          base,
          { name: "HMAC", hash: "SHA-256", length: 256 },
          false, ["sign"]);
      });
  }

  function hmacTrunc(key, headerBytes) {
    return subtle.sign("HMAC", key, headerBytes).then(function (sig) {
      return new Uint8Array(sig).slice(0, MAC_BYTES);
    });
  }

  /* Fixed 24-byte record: magic(4) version(1) flags(1) copyId(8) mac(10). */
  function buildPayload(copyId, passphrase) {
    var record = new Uint8Array(RECORD_BYTES);
    record.set(MAGIC, 0);
    record[4] = FORMAT_VERSION;
    record[5] = passphrase ? FLAG_PASSPHRASE : 0;
    record.set(copyId, 6);
    return deriveKey(passphrase).then(function (key) {
      return hmacTrunc(key, record.slice(0, HEADER_BYTES));
    }).then(function (mac) {
      record.set(mac, HEADER_BYTES);
      return record;
    });
  }

  /* ---------------------------------------------------------------- *
   * Embed — LSB of R,G,B, record repeated cyclically over the image.
   * ---------------------------------------------------------------- */
  function payloadBits(payload) {
    var n = payload.length * 8;
    var bits = new Uint8Array(n);
    for (var i = 0; i < n; i++) {
      bits[i] = (payload[i >> 3] >> (7 - (i & 7))) & 1; // MSB-first
    }
    return bits;
  }

  function embedIntoImageData(imageData, payload) {
    var d = imageData.data;
    var bits = payloadBits(payload);
    var n = imageData.width * imageData.height;
    var bi = 0;
    for (var p = 0; p < n; p++) {
      var o = p * 4;
      d[o]     = (d[o]     & 0xFE) | bits[bi++ % RECORD_BITS];
      d[o + 1] = (d[o + 1] & 0xFE) | bits[bi++ % RECORD_BITS];
      d[o + 2] = (d[o + 2] & 0xFE) | bits[bi++ % RECORD_BITS];
      // Opaque alpha: premultiplied-alpha rounding in canvas/PNG encoders can
      // corrupt RGB of translucent pixels; our exports are opaque anyway.
      d[o + 3] = 255;
    }
  }

  function embedIntoCanvas(canvas, payload) {
    var ctx = canvas.getContext("2d");
    var img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    embedIntoImageData(img, payload);
    ctx.putImageData(img, 0, 0);
  }

  /* ---------------------------------------------------------------- *
   * Decode — scan the RGB LSB bit stream for records at any bit offset
   * (re-sync after crops), then majority-vote and verify the HMAC.
   * ---------------------------------------------------------------- */
  function extractCandidates(imageData) {
    var d = imageData.data;
    var totalBits = imageData.width * imageData.height * 3;
    function getBit(i) {
      // i-th bit of the row-major RGB stream, straight from the RGBA buffer.
      return d[((i / 3) | 0) * 4 + (i % 3)] & 1;
    }
    var magicBits = payloadBits(MAGIC); // 32 bits, MSB-first
    var candidates = [];
    var off = 0;
    var last = totalBits - RECORD_BITS;
    while (off <= last && candidates.length < MAX_CANDIDATES) {
      var hit = true;
      for (var m = 0; m < 32; m++) {
        if (getBit(off + m) !== magicBits[m]) { hit = false; break; }
      }
      if (hit) {
        // Version byte too (40 matching bits total) before accepting.
        var ver = 0;
        for (var v = 0; v < 8; v++) ver = (ver << 1) | getBit(off + 32 + v);
        if (ver === FORMAT_VERSION) {
          var rec = new Uint8Array(RECORD_BYTES);
          for (var b = 0; b < RECORD_BITS; b++) {
            if (getBit(off + b)) rec[b >> 3] |= 0x80 >> (b & 7);
          }
          candidates.push(rec);
          off += RECORD_BITS;
          continue;
        }
      }
      off += 1;
    }
    return candidates;
  }

  function majorityVote(candidates) {
    var voted = new Uint8Array(RECORD_BYTES);
    var i, b;
    for (b = 0; b < RECORD_BYTES; b++) {
      for (var bit = 0; bit < 8; bit++) {
        var ones = 0;
        var mask = 0x80 >> bit;
        for (i = 0; i < candidates.length; i++) {
          if (candidates[i][b] & mask) ones++;
        }
        if (ones * 2 > candidates.length) voted[b] |= mask;
      }
    }
    var agree = 0;
    for (i = 0; i < candidates.length; i++) {
      if (bytesEq(candidates[i], voted)) agree++;
    }
    return { record: voted, agreement: candidates.length ? agree / candidates.length : 0 };
  }

  function verifyRecord(record, passphrase) {
    var header = record.slice(0, HEADER_BYTES);
    var mac = record.slice(HEADER_BYTES);
    return deriveKey("").then(function (openKey) {
      return hmacTrunc(openKey, header);
    }).then(function (openMac) {
      if (bytesEq(openMac, mac)) return { verified: true, keyed: "open" };
      if (!passphrase) return { verified: false, keyed: null };
      return deriveKey(passphrase).then(function (key) {
        return hmacTrunc(key, header);
      }).then(function (passMac) {
        if (bytesEq(passMac, mac)) return { verified: true, keyed: "passphrase" };
        return { verified: false, keyed: null };
      });
    });
  }

  /* Resolves to { found:false } or
   * { found:true, copyIdHex, verified, keyed, flags, count, agreement }. */
  function decode(imageData, passphrase) {
    var candidates = extractCandidates(imageData);
    if (!candidates.length) return Promise.resolve({ found: false });
    var vote = majorityVote(candidates);
    var record = vote.record;
    if (!bytesEq(record.slice(0, 4), MAGIC) || record[4] !== FORMAT_VERSION) {
      return Promise.resolve({ found: false });
    }
    return verifyRecord(record, passphrase).then(function (v) {
      return {
        found: true,
        copyIdHex: toHex(record.slice(6, 14)),
        verified: v.verified,
        keyed: v.keyed,
        flags: record[5],
        count: candidates.length,
        agreement: vote.agreement
      };
    });
  }

  /* ---------------------------------------------------------------- *
   * PNG text chunks — byte surgery on the encoder output (no re-encode).
   * ---------------------------------------------------------------- */
  var PNG_SIG = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

  function isPng(bytes) {
    return bytes.length > 33 && bytesEq(bytes.slice(0, 8), PNG_SIG);
  }

  function u32be(n) {
    return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
  }

  /* Insert an uncompressed iTXt chunk right after IHDR (offset 33: 8-byte
   * signature + 25-byte IHDR chunk). iTXt because the text is UTF-8 JSON
   * with user-provided labels in any language. */
  function pngInsertTextChunk(pngBytes, keyword, text) {
    if (!isPng(pngBytes)) return pngBytes;
    // data = keyword \0 compressionFlag(0) compressionMethod(0)
    //        languageTag \0 translatedKeyword \0 text
    var kw = utf8(keyword);
    var body = utf8(text);
    var data = new Uint8Array(kw.length + 5 + body.length);
    data.set(kw, 0);
    // kw.length..kw.length+4 stay 0: \0, cf=0, cm=0, empty lang \0, empty tkw \0
    data.set(body, kw.length + 5);
    var typeAndData = new Uint8Array(4 + data.length);
    typeAndData.set(utf8("iTXt"), 0);
    typeAndData.set(data, 4);
    var chunk = new Uint8Array(4 + typeAndData.length + 4);
    chunk.set(u32be(data.length), 0);
    chunk.set(typeAndData, 4);
    chunk.set(u32be(crc32(typeAndData)), 4 + typeAndData.length);
    var cut = 33; // right after IHDR
    var out = new Uint8Array(pngBytes.length + chunk.length);
    out.set(pngBytes.slice(0, cut), 0);
    out.set(chunk, cut);
    out.set(pngBytes.slice(cut), cut + chunk.length);
    return out;
  }

  /* Walk all chunks and return the text ones (iTXt + tEXt). */
  function pngReadTextChunks(pngBytes) {
    var found = [];
    if (!isPng(pngBytes)) return found;
    var dec = new TextDecoder();
    var pos = 8;
    while (pos + 12 <= pngBytes.length) {
      var len = (pngBytes[pos] << 24 | pngBytes[pos + 1] << 16 | pngBytes[pos + 2] << 8 | pngBytes[pos + 3]) >>> 0;
      var type = String.fromCharCode(pngBytes[pos + 4], pngBytes[pos + 5], pngBytes[pos + 6], pngBytes[pos + 7]);
      var data = pngBytes.slice(pos + 8, pos + 8 + len);
      if (type === "iTXt") {
        var z0 = data.indexOf(0);
        if (z0 > 0 && data[z0 + 1] === 0) { // only uncompressed
          var z1 = data.indexOf(0, z0 + 3); // end of language tag
          var z2 = z1 >= 0 ? data.indexOf(0, z1 + 1) : -1; // end of translated kw
          if (z2 >= 0) {
            found.push({ keyword: dec.decode(data.slice(0, z0)), text: dec.decode(data.slice(z2 + 1)) });
          }
        }
      } else if (type === "tEXt") {
        var zt = data.indexOf(0);
        if (zt > 0) {
          found.push({ keyword: dec.decode(data.slice(0, zt)), text: dec.decode(data.slice(zt + 1)) });
        }
      } else if (type === "IEND") {
        break;
      }
      pos += 12 + len;
    }
    return found;
  }

  SL.stego = {
    available: available,
    crc32: crc32,
    toHex: toHex,
    randomCopyId: randomCopyId,
    buildPayload: buildPayload,
    embedIntoCanvas: embedIntoCanvas,
    decode: decode,
    pngInsertTextChunk: pngInsertTextChunk,
    pngReadTextChunks: pngReadTextChunks,
    isPng: isPng
  };

})(window);
