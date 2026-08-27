// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

export const MAX_ATTACHMENT_BYTES = 64 * 1024 * 1024;

/** Read a response without allowing an untrusted remote server to exhaust memory. */
export async function readResponseWithLimit(response, limit = MAX_ATTACHMENT_BYTES, label = 'Attachment') {
  const declared = Number(response.headers?.get?.('content-length') || 0);
  if (declared > limit) throw new Error(`${label}: file exceeds the 64 MiB limit.`);
  if (!response.body?.getReader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > limit) throw new Error(`${label}: file exceeds the 64 MiB limit.`);
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      total += chunk.byteLength;
      if (total > limit) throw new Error(`${label}: file exceeds the 64 MiB limit.`);
      chunks.push(chunk);
    }
  } catch (error) {
    try { await reader.cancel(); } catch { /* best effort */ }
    throw error;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
