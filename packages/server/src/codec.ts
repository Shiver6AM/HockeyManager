/**
 * Compression for what the server stores in the database. Writes cross the
 * network to the database host, so their size is outbound traffic: Brotli
 * (quality 6) makes the league document ~15% smaller than gzip at about the
 * same speed. Reads accept either, so rows written as gzip still load.
 */
import { promisify } from 'node:util';
import { brotliCompress, brotliDecompressSync, constants, gunzipSync } from 'node:zlib';

const brotliAsync = promisify(brotliCompress);

export function pack(text: string): Promise<Buffer> {
  return brotliAsync(text, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 6,
      [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
      [constants.BROTLI_PARAM_SIZE_HINT]: Buffer.byteLength(text),
    },
  });
}

/** gzip starts with 1f 8b; anything else is Brotli. */
export function unpack(data: Uint8Array): string {
  const buf = Buffer.from(data);
  return (buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : brotliDecompressSync(buf)).toString('utf8');
}
