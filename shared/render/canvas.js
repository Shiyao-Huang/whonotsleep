// WhoNotSleep renderer — canvas buffers + drawing primitives.
// All buffers are typed arrays; no per-pixel allocation.
import { PAL, NPAL, P, BAYER4 } from './palette.js';

export const PLANE = { WALL: 0, FLOOR: 1, FRONT: 2, TOP: 3, CHAR: 4, SKY: 5 };

export function createCanvas(w, h) {
  const n = w * h;
  return {
    w, h, n,
    alb: new Uint8Array(n),          // albedo palette index
    emit: new Float32Array(n * 3),   // emissive RGB (0..1+)
    light: new Float32Array(n * 3),  // accumulated light
    occ: new Uint8Array(n),          // light occlusion/AO 0..255 (255 = open)
    plane: new Uint8Array(n),        // surface kind hint (PLANE)
    id: new Uint8Array(n),           // object id (characters: 1+memberIndex)
    over: new Int16Array(n),         // overlay palette idx drawn after lighting, -1 none
    col: new Float32Array(n * 3),    // composed colour
    spread: new Float32Array(n),     // dither amplitude map
    qidx: new Uint8Array(n),         // quantized palette index
    rgba: new Uint8ClampedArray(n * 4),
    ox: 0, oy: 0,                    // drawing offset (for cropped layouts)
  };
}

export function clearCanvas(c, bg = 0) {
  c.alb.fill(bg); c.emit.fill(0); c.light.fill(0); c.occ.fill(255);
  c.plane.fill(0); c.id.fill(0); c.over.fill(-1); c.ox = 0; c.oy = 0;
}

// ------------------------------------------------------------ albedo layer
export function px(c, x, y, idx, plane = -1, id = -1) {
  x = (x + c.ox) | 0; y = (y + c.oy) | 0;
  if (x < 0 || y < 0 || x >= c.w || y >= c.h) return;
  const i = y * c.w + x;
  c.alb[i] = idx;
  if (plane >= 0) c.plane[i] = plane;
  if (id >= 0) c.id[i] = id;
}

export function rect(c, x, y, w, h, idx, plane = -1, id = -1) {
  let x0 = (x + c.ox) | 0, y0 = (y + c.oy) | 0, x1 = x0 + (w | 0), y1 = y0 + (h | 0);
  if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0; if (x1 > c.w) x1 = c.w; if (y1 > c.h) y1 = c.h;
  for (let yy = y0; yy < y1; yy++) {
    let i = yy * c.w + x0;
    for (let xx = x0; xx < x1; xx++, i++) {
      c.alb[i] = idx;
      if (plane >= 0) c.plane[i] = plane;
      if (id >= 0) c.id[i] = id;
    }
  }
}

/** two-colour ordered dither fill: level 0..1 = fraction of colour b */
export function dither(c, x, y, w, h, a, b, level, plane = -1) {
  let x0 = (x + c.ox) | 0, y0 = (y + c.oy) | 0, x1 = x0 + (w | 0), y1 = y0 + (h | 0);
  if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0; if (x1 > c.w) x1 = c.w; if (y1 > c.h) y1 = c.h;
  const th = level - 0.5;
  for (let yy = y0; yy < y1; yy++) {
    let i = yy * c.w + x0;
    for (let xx = x0; xx < x1; xx++, i++) {
      c.alb[i] = BAYER4[((yy & 3) << 2) | (xx & 3)] < th ? b : a;
      if (plane >= 0) c.plane[i] = plane;
    }
  }
}

/** vertical banded gradient through palette stops, dithered between bands */
export function vgrad(c, x, y, w, h, stops, plane = -1) {
  const n = stops.length - 1;
  for (let yy = 0; yy < h; yy++) {
    const t = n * yy / Math.max(1, h - 1);
    const k = Math.min(n - 1, Math.floor(t));
    let f = (t - k - 0.5) * 2.2 + 0.5; f = f < 0 ? 0 : f > 1 ? 1 : f;
    dither(c, x, y + yy, w, 1, stops[k], stops[k + 1], f, plane);
  }
}

export function hline(c, x, y, w, idx, plane = -1, id = -1) { rect(c, x, y, w, 1, idx, plane, id); }
export function vline(c, x, y, h, idx, plane = -1, id = -1) { rect(c, x, y, 1, h, idx, plane, id); }

/** Bresenham line in albedo (or overlay when over=true) */
export function line(c, x0, y0, x1, y1, idx, over = false) {
  x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    if (over) opx(c, x0, y0, idx); else px(c, x0, y0, idx);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

// ---------------------------------------------------------- emissive layer
/** emissive pixel: albedo set to idx (or base) and emission = colour * k */
export function gpx(c, x, y, idx, k = 1, base = -1) {
  x = (x + c.ox) | 0; y = (y + c.oy) | 0;
  if (x < 0 || y < 0 || x >= c.w || y >= c.h) return;
  const i = y * c.w + x;
  c.alb[i] = base >= 0 ? base : idx;
  const s = k / 255;
  c.emit[i * 3] += PAL[idx * 3] * s;
  c.emit[i * 3 + 1] += PAL[idx * 3 + 1] * s;
  c.emit[i * 3 + 2] += PAL[idx * 3 + 2] * s;
}

export function grect(c, x, y, w, h, idx, k = 1, base = -1) {
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) gpx(c, x + xx, y + yy, idx, k, base);
}

/** add raw emissive RGB (0..1 floats) without touching albedo */
export function addEmit(c, x, y, r, g, b) {
  x = (x + c.ox) | 0; y = (y + c.oy) | 0;
  if (x < 0 || y < 0 || x >= c.w || y >= c.h) return;
  const i = (y * c.w + x) * 3;
  c.emit[i] += r; c.emit[i + 1] += g; c.emit[i + 2] += b;
}

// ------------------------------------------------------- occlusion / AO
/** multiply received light in a rect by f (0..1), with optional soft edge rows */
export function shade(c, x, y, w, h, f) {
  let x0 = (x + c.ox) | 0, y0 = (y + c.oy) | 0, x1 = x0 + (w | 0), y1 = y0 + (h | 0);
  if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0; if (x1 > c.w) x1 = c.w; if (y1 > c.h) y1 = c.h;
  for (let yy = y0; yy < y1; yy++) for (let i = yy * c.w + x0, e = yy * c.w + x1; i < e; i++) c.occ[i] = (c.occ[i] * f) | 0;
}

/** soft elliptical contact shadow */
export function blobShadow(c, cx, cy, rx, ry, f) {
  for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++) {
    const d = (x * x) / (rx * rx) + (y * y) / (ry * ry);
    if (d > 1) continue;
    const X = (cx + x + c.ox) | 0, Y = (cy + y + c.oy) | 0;
    if (X < 0 || Y < 0 || X >= c.w || Y >= c.h) continue;
    const i = Y * c.w + X;
    c.occ[i] = (c.occ[i] * (1 - (1 - f) * (1 - d * d))) | 0;
  }
}

// ---------------------------------------------------------- overlay layer
export function opx(c, x, y, idx) {
  x = (x + c.ox) | 0; y = (y + c.oy) | 0;
  if (x < 0 || y < 0 || x >= c.w || y >= c.h) return;
  c.over[y * c.w + x] = idx;
}
export function orect(c, x, y, w, h, idx) {
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) opx(c, x + xx, y + yy, idx);
}

// ----------------------------------------------------------------- sprites
/**
 * Parse a string bitmap. legend: char -> palette name, or {c:name, e:k} for emissive.
 * '.' and ' ' are transparent. Result is cached on the rows array.
 */
export function sprite(rows, legend) {
  if (rows._spr) return rows._spr;
  const h = rows.length, w = Math.max(...rows.map((r) => r.length));
  const idx = new Int16Array(w * h).fill(-1);
  const em = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < rows[y].length; x++) {
    const ch = rows[y][x];
    if (ch === '.' || ch === ' ') continue;
    const L = legend[ch];
    if (L === undefined) throw new Error('sprite: no legend for ' + ch);
    if (typeof L === 'string') idx[y * w + x] = P[L];
    else { idx[y * w + x] = P[L.c]; em[y * w + x] = L.e || 0; }
  }
  const spr = { w, h, idx, em };
  Object.defineProperty(rows, '_spr', { value: spr, enumerable: false });
  return spr;
}

/**
 * Blit sprite. opts: flip, plane, id, over (overlay layer), remap (Int16Array NPAL -> idx),
 * emitK (multiplier for emissive pixels)
 */
export function blit(c, spr, x, y, opts = {}) {
  const { flip = false, plane = -1, id = -1, over = false, remap = null, emitK = 1 } = opts;
  for (let sy = 0; sy < spr.h; sy++) for (let sx = 0; sx < spr.w; sx++) {
    const si = sy * spr.w + (flip ? spr.w - 1 - sx : sx);
    let k = spr.idx[si];
    if (k < 0) continue;
    if (remap && remap[k] >= 0) k = remap[k];
    if (over) { opx(c, x + sx, y + sy, k); continue; }
    if (spr.em[si] > 0) gpx(c, x + sx, y + sy, k, spr.em[si] * emitK);
    else px(c, x + sx, y + sy, k, plane, id);
  }
}

export function makeRemap(pairs) {
  const r = new Int16Array(NPAL).fill(-1);
  for (const [a, b] of pairs) r[P[a]] = typeof b === 'number' ? b : P[b];
  return r;
}

// deterministic hash noise
export function hash2(x, y, s = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** dark selective outline around pixels of object `id` inside bbox */
export function outline(c, x0, y0, x1, y1, id, idx) {
  x0 += c.ox; x1 += c.ox; y0 += c.oy; y1 += c.oy;
  for (let y = Math.max(0, y0 - 1); y < Math.min(c.h, y1 + 1); y++) for (let x = Math.max(0, x0 - 1); x < Math.min(c.w, x1 + 1); x++) {
    const i = y * c.w + x;
    if (c.id[i] === id) continue;
    const n = (x > 0 && c.id[i - 1] === id) || (x < c.w - 1 && c.id[i + 1] === id) || (y > 0 && c.id[i - c.w] === id) || (y < c.h - 1 && c.id[i + c.w] === id);
    if (n) { c.alb[i] = idx; c.id[i] = 200; }
  }
}
