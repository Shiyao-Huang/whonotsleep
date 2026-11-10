// WhoNotSleep — tiny PNG encoder (RGBA8, nearest-neighbour integer upscale).
// Dependency-free ESM, Hermes-safe (no Buffer / TextEncoder). The deflate
// implementation is injected: pako.deflate in React Native, zlib.deflateSync in Node.

let CRC_TABLE = null;
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  CRC_TABLE = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    CRC_TABLE[n] = c >>> 0;
  }
  return CRC_TABLE;
}

function crc32(bytes, start, end) {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function writeU32(out, pos, v) {
  out[pos] = (v >>> 24) & 0xff;
  out[pos + 1] = (v >>> 16) & 0xff;
  out[pos + 2] = (v >>> 8) & 0xff;
  out[pos + 3] = v & 0xff;
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  writeU32(out, 0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  writeU32(out, 8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

/**
 * Encode RGBA pixels as PNG.
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array|Uint8ClampedArray} rgba  width*height*4 bytes
 * @param {{scale?:number, deflate:(u8:Uint8Array)=>Uint8Array, opaque?:boolean}} opts
 *   opaque: encode as RGB (colour type 2) when every alpha is 255 (smaller output). default: auto.
 * @returns {Uint8Array}
 */
export function encodePNG(width, height, rgba, opts = {}) {
  const { deflate } = opts;
  if (typeof deflate !== 'function') throw new Error('encodePNG: opts.deflate(Uint8Array) is required');
  const scale = Math.max(1, Math.min(32, Math.floor(opts.scale || 1)));
  const W = width * scale;
  const H = height * scale;

  let opaque = opts.opaque;
  if (opaque === undefined) {
    opaque = true;
    for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) { opaque = false; break; }
  }
  const bpp = opaque ? 3 : 4;
  const stride = W * bpp + 1;
  const raw = new Uint8Array(stride * H);

  // Build first scaled row of each source row, then copy it (scale-1) times.
  // Filter: row 0 of each block uses "Sub" (1) which compresses flat pixel art
  // runs well; repeated rows use "Up" (2) which becomes all zeros.
  const line = new Uint8Array(W * bpp);
  for (let y = 0; y < height; y++) {
    let p = 0;
    const srcRow = y * width * 4;
    for (let x = 0; x < width; x++) {
      const s = srcRow + x * 4;
      const r = rgba[s], g = rgba[s + 1], b = rgba[s + 2], a = rgba[s + 3];
      for (let k = 0; k < scale; k++) {
        line[p++] = r; line[p++] = g; line[p++] = b;
        if (bpp === 4) line[p++] = a;
      }
    }
    for (let k = 0; k < scale; k++) {
      const o = (y * scale + k) * stride;
      if (k === 0) {
        raw[o] = 1; // Sub
        for (let i = 0; i < line.length; i++) {
          raw[o + 1 + i] = (line[i] - (i >= bpp ? line[i - bpp] : 0)) & 0xff;
        }
      } else {
        raw[o] = 2; // Up: identical to previous row -> zeros
        // bytes already 0 in a fresh Uint8Array
      }
    }
  }

  const ihdr = new Uint8Array(13);
  writeU32(ihdr, 0, W);
  writeU32(ihdr, 4, H);
  ihdr[8] = 8; // bit depth
  ihdr[9] = opaque ? 2 : 6; // colour type RGB / RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  let z = deflate(raw);
  if (!(z instanceof Uint8Array)) z = new Uint8Array(z);
  else if (z.constructor !== Uint8Array) z = new Uint8Array(z.buffer, z.byteOffset, z.byteLength);

  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [sig, chunk('IHDR', ihdr), chunk('IDAT', z), chunk('IEND', new Uint8Array(0))];
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Standard base64 (with padding) of a byte array. Pure JS. */
export function bytesToBase64(bytes) {
  const n = bytes.length;
  const parts = [];
  let chunkStr = '';
  let i = 0;
  for (; i + 2 < n; i += 3) {
    const v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    chunkStr += B64[(v >> 18) & 63] + B64[(v >> 12) & 63] + B64[(v >> 6) & 63] + B64[v & 63];
    if (chunkStr.length > 8192) { parts.push(chunkStr); chunkStr = ''; }
  }
  if (i < n) {
    const v = (bytes[i] << 16) | ((i + 1 < n ? bytes[i + 1] : 0) << 8);
    chunkStr += B64[(v >> 18) & 63] + B64[(v >> 12) & 63];
    chunkStr += i + 1 < n ? B64[(v >> 6) & 63] : '=';
    chunkStr += '=';
  }
  parts.push(chunkStr);
  return parts.join('');
}

/** Convenience: data URL from an encoded PNG. */
export function pngDataUrl(pngBytes) {
  return 'data:image/png;base64,' + bytesToBase64(pngBytes);
}
