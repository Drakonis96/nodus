// Ambient declaration for heic-decode (ships no TypeScript types). The library's
// default export decodes a HEIC/HEIF buffer into raw RGBA pixels.
declare module 'heic-decode' {
  interface HeicDecodeInput {
    buffer: Uint8Array | ArrayBuffer | Buffer;
  }
  interface HeicDecodeResult {
    width: number;
    height: number;
    data: ArrayBuffer | Uint8Array;
  }
  function decode(input: HeicDecodeInput): Promise<HeicDecodeResult>;
  export default decode;
  export function all(input: HeicDecodeInput): Promise<Array<{ decode: () => Promise<HeicDecodeResult> }>>;
}
