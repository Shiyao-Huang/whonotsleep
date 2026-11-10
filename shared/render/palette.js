// WhoNotSleep renderer — curated palette + Bayer-dithered quantization.
// Lo-fi night room: indigo/navy shadows, warm amber lamps, coral/mint/violet glows.
// Every ramp runs down into a dark tone so lit-dark areas keep their hue.

export const PALETTE_HEX = {
  // indigo / navy night ramp
  ink0: '#08081a', ink1: '#111129', ink2: '#1a1a3b', ink3: '#24264f',
  ink4: '#313567', ink5: '#424a83', ink6: '#5a64a0', ink7: '#7884bc',
  // moonlight / cool highlights
  mist: '#a3b4e0', frost: '#d0dcf4', white: '#f6f2ea',
  // warm greys
  g1: '#2a2733', g2: '#433e4c', g3: '#686171', g4: '#978f9f', g5: '#c8c0c6',
  // wood
  w0: '#22151b', w1: '#382126', w2: '#53312f', w3: '#744737', w4: '#986344', w5: '#be8857',
  // amber / lamp
  a1: '#d4844a', a2: '#eda95c', a3: '#ffcf80', a4: '#ffebb3',
  // coral / red
  r0: '#3b1727', r1: '#6b2537', r2: '#a53b46', r3: '#d8675a', r4: '#f39678',
  // pink
  p2: '#bf5490', p3: '#f28dbe',
  // violet
  v0: '#281c47', v1: '#432f78', v2: '#684cac', v3: '#9a7ade', v4: '#cbb3ff',
  // mint / teal
  t0: '#0f272e', t1: '#19474b', t2: '#25766a', t3: '#3eae8e', t4: '#7ee8c1', t5: '#cdffea',
  // greens (plants)
  e1: '#1c3223', e2: '#2b5131', e3: '#467e3d', e4: '#7ab657',
  // blues (day sky, gemini)
  b1: '#29488a', b2: '#3e6ec5', b3: '#6f9fef', b4: '#a9d3ff',
  // skin
  s0: '#55301f', s1: '#874f33', s2: '#b6744e', s3: '#d89a6d', s4: '#efbd92', s5: '#ffdcbe',
  // accents
  y2: '#e9c84f', o2: '#f07c3c',
  // dusk plums: bridge warm wood + cool moonlight so mixed light never turns grey
  // alarm red (overlay-only accent for the caught badge)
  q1: '#b81f3a', q2: '#ff4a55',
  m0: '#1c1427', m1: '#2c1e35', m2: '#423049', m3: '#5c435f',
};

export const NAMES = Object.keys(PALETTE_HEX);
export const NPAL = NAMES.length;
/** P.name -> palette index */
export const P = {};
/** flat RGB 0..255, 3 per entry */
export const PAL = new Uint8Array(NPAL * 3);
NAMES.forEach((n, i) => {
  P[n] = i;
  const h = PALETTE_HEX[n];
  PAL[i * 3] = parseInt(h.slice(1, 3), 16);
  PAL[i * 3 + 1] = parseInt(h.slice(3, 5), 16);
  PAL[i * 3 + 2] = parseInt(h.slice(5, 7), 16);
});

export function hexOf(idx) { return PALETTE_HEX[NAMES[idx]]; }

/** nearest palette index for an RGB 0..255 triple (weighted distance) */
export function nearest(r, g, b) {
  let best = 0, bd = 1e12;
  for (let i = 0; i < NPAL; i++) {
    const dr = r - PAL[i * 3], dg = g - PAL[i * 3 + 1], db = b - PAL[i * 3 + 2];
    const rm = (r + PAL[i * 3]) * 0.5;
    const d = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

// 5-bit-per-channel lookup cube -> palette index (built lazily, ~32k entries)
let LUT = null;
function lut() {
  if (LUT) return LUT;
  LUT = new Uint8Array(32768);
  for (let r = 0; r < 32; r++) for (let g = 0; g < 32; g++) for (let b = 0; b < 32; b++) {
    LUT[(r << 10) | (g << 5) | b] = nearest(r * 8.226, g * 8.226, b * 8.226);
  }
  return LUT;
}

// 4x4 Bayer matrix, centred to -0.5..0.5
export const BAYER4 = new Float32Array([0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16 - 0.5));

/**
 * Quantize float RGB (0..1+) to palette with ordered dithering.
 * spread: Float32Array per pixel (0..1) controlling dither amplitude, or null.
 * outIdx (Uint8Array w*h) receives palette indices, rgba receives colours.
 */
export function quantize(w, h, rgbF, spread, amp, outIdx, rgba) {
  const L = lut();
  for (let y = 0, i = 0; y < h; y++) {
    const brow = (y & 3) << 2;
    for (let x = 0; x < w; x++, i++) {
      const s = spread ? spread[i] * amp : amp;
      const d = BAYER4[brow | (x & 3)] * s;
      let r = rgbF[i * 3] * 255 + d, g = rgbF[i * 3 + 1] * 255 + d, b = rgbF[i * 3 + 2] * 255 + d;
      r = r < 0 ? 0 : r > 255 ? 255 : r;
      g = g < 0 ? 0 : g > 255 ? 255 : g;
      b = b < 0 ? 0 : b > 255 ? 255 : b;
      const k = L[((r * 0.1216) << 10) | ((g * 0.1216) << 5) | (b * 0.1216)];
      outIdx[i] = k;
      const o = i * 4;
      rgba[o] = PAL[k * 3]; rgba[o + 1] = PAL[k * 3 + 1]; rgba[o + 2] = PAL[k * 3 + 2]; rgba[o + 3] = 255;
    }
  }
}

/** Interpolate between palette colours a,b (indices) -> [r,g,b] floats 0..1 into out */
export function mixRGB(out, a, b, t) {
  for (let c = 0; c < 3; c++) out[c] = (PAL[a * 3 + c] * (1 - t) + PAL[b * 3 + c] * t) / 255;
  return out;
}
