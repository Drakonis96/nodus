import os from 'node:os';

// Float32 little-endian, the byte order of every platform Nodus ships on. Providers
// return float32 embeddings, so nothing is lost; the JSON text these replace took
// roughly five times the space and was parsed again on every semantic search.
if (os.endianness() !== 'LE') throw new Error('documentary_vectors_require_little_endian');

export function encodeDocumentaryVector(vector: ArrayLike<number>): Buffer {
  const values = Float32Array.from(vector);
  return Buffer.from(values.buffer, values.byteOffset, values.byteLength);
}

/** A view over the blob when it is 4-byte aligned (always, in practice), a copy otherwise.
 * Semantic search decodes every candidate, so it avoids copying. */
export function decodeDocumentaryVector(blob: Uint8Array): Float32Array {
  if (blob.byteLength % 4) throw new Error('documentary_vector_corrupt');
  return blob.byteOffset % 4 === 0
    ? new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4)
    : new Float32Array(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength));
}

/** A passage vector in either the binary or the legacy JSON column. */
export function storedDocumentaryVector(row: { vector?: Uint8Array | null; vector_json?: string | null }): number[] | null {
  if (row.vector) return Array.from(decodeDocumentaryVector(row.vector));
  return row.vector_json ? JSON.parse(row.vector_json) as number[] : null;
}
