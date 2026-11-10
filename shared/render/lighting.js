// WhoNotSleep renderer — lighting: time of day, point/cone lights, window shaft,
// bloom on emissive, composition and dither-spread map.
import { PAL, P } from './palette.js';
import { PLANE } from './canvas.js';

const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

// key moments of the day: hour -> params
const KEYS = [
  { h: 0,    amb: [0.21, 0.22, 0.44], shaft: [0.42, 0.55, 0.95], sk: 0.75, stars: 1, moon: 1, sun: 0, city: 1 },
  { h: 4.5,  amb: [0.21, 0.22, 0.43], shaft: [0.42, 0.55, 0.95], sk: 0.65, stars: 1, moon: 1, sun: 0, city: 0.7 },
  { h: 6,    amb: [0.52, 0.42, 0.56], shaft: [1.0, 0.62, 0.62], sk: 0.75, stars: 0.2, moon: 0.2, sun: 0.6, city: 0.3 },
  { h: 7.5,  amb: [0.78, 0.70, 0.72], shaft: [1.0, 0.82, 0.70], sk: 0.85, stars: 0, moon: 0, sun: 1, city: 0 },
  { h: 10,   amb: [0.96, 0.94, 0.90], shaft: [1.0, 0.95, 0.80], sk: 0.70, stars: 0, moon: 0, sun: 1, city: 0 },
  { h: 15.5, amb: [0.96, 0.92, 0.86], shaft: [1.0, 0.90, 0.72], sk: 0.75, stars: 0, moon: 0, sun: 1, city: 0 },
  { h: 17.5, amb: [0.78, 0.56, 0.52], shaft: [1.0, 0.62, 0.34], sk: 1.0, stars: 0, moon: 0, sun: 1, city: 0.3 },
  { h: 19,   amb: [0.42, 0.32, 0.48], shaft: [0.95, 0.45, 0.45], sk: 0.6, stars: 0.4, moon: 0.4, sun: 0.3, city: 0.8 },
  { h: 20.5, amb: [0.22, 0.23, 0.45], shaft: [0.45, 0.55, 0.95], sk: 0.7, stars: 1, moon: 1, sun: 0, city: 1 },
  { h: 24,   amb: [0.21, 0.22, 0.44], shaft: [0.42, 0.55, 0.95], sk: 0.75, stars: 1, moon: 1, sun: 0, city: 1 },
];

/** Interpolated time-of-day parameters for hour 0..24 */
export function timeOfDay(hour) {
  hour = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].h <= hour) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = smooth(0, 1, (hour - a.h) / (b.h - a.h));
  const mix3 = (u, v) => [lerp(u[0], v[0], t), lerp(u[1], v[1], t), lerp(u[2], v[2], t)];
  const phase = hour < 5 || hour >= 20.5 ? 'night' : hour < 7.5 ? 'dawn' : hour < 16.5 ? 'day' : hour < 19.5 ? 'dusk' : 'night';
  // sun/moon arc progress used for shaft slope + sky body position
  const sunP = (hour - 6) / 13;           // 0 at 6h, 1 at 19h
  const moonP = (((hour - 19 + 24) % 24)) / 11; // 0 at 19h, 1 at 6h
  return {
    hour, phase,
    amb: mix3(a.amb, b.amb), shaft: mix3(a.shaft, b.shaft),
    shaftK: lerp(a.sk, b.sk, t), stars: lerp(a.stars, b.stars, t), moon: lerp(a.moon, b.moon, t),
    sun: lerp(a.sun, b.sun, t), city: lerp(a.city, b.city, t),
    sunP, moonP,
    // shaft slope dx per dy: sun from left in the morning, right in the evening
    slope: phase === 'night' ? lerp(-0.55, 0.55, Math.min(1, Math.max(0, moonP))) : lerp(-0.9, 0.9, Math.min(1, Math.max(0, sunP))),
  };
}

/**
 * Point light. L = {x, y, r, rgb:[0..1], k, dir:[dx,dy]|null, cos: cone half-angle cosine, soft,
 * floor: vertical squash on floor plane (default 2), wallK: multiplier on wall}
 */
export function addLight(c, L) {
  const { x, y, r, rgb, k = 1, dir = null, cos = 0, soft = 0.25, floorSquash = 2, wallK = 1, charK = 1, blockY = 1e9, blockK = 0.3 } = L;
  const x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(c.w - 1, Math.ceil(x + r));
  const y0 = Math.max(0, Math.floor(y - r)), y1 = Math.min(c.h - 1, Math.ceil(y + r * floorSquash));
  const r2 = r * r, cr = rgb[0] * k, cg = rgb[1] * k, cb = rgb[2] * k;
  let ddx = 0, ddy = 0;
  if (dir) { const l = Math.hypot(dir[0], dir[1]) || 1; ddx = dir[0] / l; ddy = dir[1] / l; }
  for (let py = y0; py <= y1; py++) {
    for (let pxx = x0; pxx <= x1; pxx++) {
      const i = py * c.w + pxx;
      const pl = c.plane[i];
      let dx = pxx + 0.5 - x, dy = py + 0.5 - y;
      if (pl === PLANE.FLOOR && dy > 0) dy /= floorSquash;
      const d2 = dx * dx + dy * dy;
      if (d2 >= r2) continue;
      let f = 1 - d2 / r2; f *= f;
      if (dir) {
        const dl = Math.sqrt(d2) || 1;
        const cs = (dx * ddx + dy * ddy) / dl;
        if (cs < cos - soft) continue;
        if (cs < cos) f *= (cs - (cos - soft)) / soft;
      }
      if (py > blockY && pl !== PLANE.FLOOR) f *= blockK;
      if (pl === PLANE.WALL) f *= wallK;
      else if (pl === PLANE.CHAR) f *= charK;
      else if (pl === PLANE.SKY) continue;
      c.light[i * 3] += f * cr; c.light[i * 3 + 1] += f * cg; c.light[i * 3 + 2] += f * cb;
    }
  }
}

/**
 * Window light shaft: parallelogram from the window's bottom edge going down with slope.
 * W = {x, y, w, h (window rect), bottom: y where the shaft ends, slope, rgb, k, mullions:[x offsets]}
 */
export function addShaft(c, W) {
  const { x, y, w, h, bottom, slope, rgb, k, mullions = [], haze = 0.10, floorY = 0 } = W;
  const yb = y + h;
  const len = Math.max(1, bottom - yb);
  for (let py = Math.max(0, y); py < Math.min(c.h, bottom); py++) {
    const below = py >= yb;
    const t = below ? (py - yb) / len : 0;
    const fall = below ? (1 - t) * (1 - t * 0.4) : 0;
    for (let pxx = 0; pxx < c.w; pxx++) {
      const u = pxx + 0.5 - slope * (py - yb) - x; // position along window bottom edge
      if (u < -1 || u > w + 1) continue;
      const i = py * c.w + pxx;
      const pl = c.plane[i];
      if (!below) continue;
      let e = 1;
      if (u < 1) e = Math.max(0, (u + 1) / 2); else if (u > w - 1) e = Math.max(0, (w + 1 - u) / 2);
      for (let m = 0; m < mullions.length; m++) if (Math.abs(u - mullions[m]) < 0.9) e *= 0.25;
      let f = fall * e * k;
      if (pl === PLANE.SKY) continue;
      // surfaces catch the shaft (floor & tops strongest), and the air gets a faint haze
      const catchK = pl === PLANE.FLOOR ? 1 : pl === PLANE.TOP ? 0.7 : pl === PLANE.WALL ? (floorY && py < floorY ? 0.18 : 0.5) : 0.32;
      c.light[i * 3] += f * rgb[0] * catchK; c.light[i * 3 + 1] += f * rgb[1] * catchK; c.light[i * 3 + 2] += f * rgb[2] * catchK;
      const hz = f * haze;
      c.emit[i * 3] += hz * rgb[0]; c.emit[i * 3 + 1] += hz * rgb[1]; c.emit[i * 3 + 2] += hz * rgb[2];
    }
  }
}

// ------------------------------------------------------------ bloom
const BUF = {};
function buf(name, n) {
  const k = name + n;
  return BUF[k] || (BUF[k] = new Float32Array(n));
}

function boxBlur(src, tmp, w, h, r) {
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) for (let ch = 0; ch < 3; ch++) {
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[(y * w + Math.min(w - 1, Math.max(0, x))) * 3 + ch];
    for (let x = 0; x < w; x++) {
      tmp[(y * w + x) * 3 + ch] = acc * inv;
      acc += src[(y * w + Math.min(w - 1, x + r + 1)) * 3 + ch] - src[(y * w + Math.max(0, x - r)) * 3 + ch];
    }
  }
  for (let x = 0; x < w; x++) for (let ch = 0; ch < 3; ch++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[(Math.min(h - 1, Math.max(0, y)) * w + x) * 3 + ch];
    for (let y = 0; y < h; y++) {
      src[(y * w + x) * 3 + ch] = acc * inv;
      acc += tmp[(Math.min(h - 1, y + r + 1) * w + x) * 3 + ch] - tmp[(Math.max(0, y - r) * w + x) * 3 + ch];
    }
  }
}

function wt(c, q) { return c.plane[q] === PLANE.SKY ? 0.3 : 1; }

/** returns half-res blurred emissive buffer {b, w, h} */
function bloomBuffer(c) {
  const w = c.w >> 1, h = c.h >> 1;
  const b = buf('bl', w * h * 3), t = buf('bt', w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let ch = 0; ch < 3; ch++) {
    const p0 = (2 * y) * c.w + 2 * x, i0 = p0 * 3 + ch;
    b[(y * w + x) * 3 + ch] = (c.emit[i0] * wt(c, p0) + c.emit[i0 + 3] * wt(c, p0 + 1) + c.emit[i0 + c.w * 3] * wt(c, p0 + c.w) + c.emit[i0 + c.w * 3 + 3] * wt(c, p0 + c.w + 1)) * 0.25;
  }
  boxBlur(b, t, w, h, 2);
  boxBlur(b, t, w, h, 2);
  return { b, w, h };
}

/**
 * Compose final colour: col = alb * (amb + light) * occ + emit + bloom.
 * Also fills c.spread with a dither-amplitude map from light gradients.
 */
function vignette(w, h) {
  const k = 'vg' + w + 'x' + h;
  if (BUF[k]) return BUF[k];
  const v = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (x + 0.5 - w / 2) / (w / 2), dy = (y + 0.5 - h / 2) / (h / 2);
    const r = Math.sqrt(dx * dx * 0.8 + dy * dy * 0.9);
    v[y * w + x] = 1 - 0.3 * smooth(0.6, 1.3, r);
  }
  return (BUF[k] = v);
}

// skin albedos get a warm sub-surface lift so faces never go grey-violet under cool light
const SKINW = new Float32Array(256);
for (const n of ['s0', 's1', 's2', 's3', 's4', 's5']) SKINW[P[n]] = 1;
const WARM = [0.07, 0.025, -0.035];

export function compose(c, amb, bloomK = 0.9, charFill = null) {
  const vg = vignette(c.w, c.h);
  const { b, w: bw, h: bh } = bloomBuffer(c);
  const lum = buf('lum', c.n);
  const W = c.w;
  for (let y = 0; y < c.h; y++) {
    const fy = Math.min(bh - 1.001, Math.max(0, (y - 0.5) * 0.5));
    const y0 = fy | 0, ty = fy - y0;
    for (let x = 0; x < W; x++) {
      const i = y * W + x, i3 = i * 3;
      const fx = Math.min(bw - 1.001, Math.max(0, (x - 0.5) * 0.5));
      const x0 = fx | 0, tx = fx - x0;
      const j00 = (y0 * bw + x0) * 3, j01 = j00 + 3, j10 = j00 + bw * 3, j11 = j10 + 3;
      const o = c.occ[i] / 255 * vg[i];
      const cf = charFill && c.plane[i] === 4;
      const a = c.alb[i] * 3;
      let ll = 0;
      for (let ch = 0; ch < 3; ch++) {
        const bl = ((b[j00 + ch] * (1 - tx) + b[j01 + ch] * tx) * (1 - ty) + (b[j10 + ch] * (1 - tx) + b[j11 + ch] * tx) * ty) * bloomK;
        const L0 = amb[ch] + c.light[i3 + ch] + (cf ? charFill[ch] + SKINW[c.alb[i]] * WARM[ch] : 0);
        let L = L0 * o;
        if (L > 0.85) L = 0.85 + (L - 0.85) / (1 + (L - 0.85) * 2.2); // soft knee: no blown-out blobs
        c.col[i3 + ch] = (PAL[a + ch] / 255) * L + c.emit[i3 + ch] + bl;
        ll += L0 * vg[i] + bl * 1.5;
      }
      lum[i] = ll;
    }
  }
  // dither amplitude ~ local light gradient: flat-lit areas stay clean, falloffs get dithered
  for (let y = 0; y < c.h; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const gx = lum[y * W + Math.min(W - 1, x + 1)] - lum[y * W + Math.max(0, x - 1)];
    const gy = lum[Math.min(c.h - 1, y + 1) * W + x] - lum[Math.max(0, y - 1) * W + x];
    const g = Math.abs(gx) + Math.abs(gy);
    const q = (g - 0.02) * 2.6;
    c.spread[i] = c.plane[i] === PLANE.SKY ? 0.2 : q <= 0 ? 0 : q >= 1 ? 1 : q;
  }
}

/** colour of a palette entry as 0..1 floats */
export function rgbOf(idx, mul = 1) { return [PAL[idx * 3] / 255 * mul, PAL[idx * 3 + 1] / 255 * mul, PAL[idx * 3 + 2] / 255 * mul]; }
export { P };

/** rim light: CHAR pixels of object `id` whose neighbour toward the light (side -1 left / +1 right) is not that object */
export function rimLight(c, x0, y0, x1, y1, id, side, rgb, k) {
  for (let y = Math.max(0, y0); y < Math.min(c.h, y1); y++) for (let x = Math.max(1, x0); x < Math.min(c.w - 1, x1); x++) {
    const i = y * c.w + x;
    if (c.id[i] !== id || c.plane[i] !== PLANE.CHAR) continue;
    if (c.id[i + side] === id) continue;
    c.light[i * 3] += rgb[0] * k; c.light[i * 3 + 1] += rgb[1] * k; c.light[i * 3 + 2] += rgb[2] * k;
  }
}

/**
 * Window-shaped light patch on the floor (projected panes with mullion cross).
 * F = {x, w, y0, y1, slope, rgb, k}
 */
export function addFloorPatch(c, F) {
  const { x, w, y0, y1, slope, rgb, k } = F;
  const h = y1 - y0;
  for (let py = Math.max(0, y0); py < Math.min(c.h, y1); py++) {
    const v = (py - y0) / h;
    const sx = x + slope * (py - y0) * 2.2 - v * 6;
    const ww = w * (1 + v * 0.35);
    const fade = 0.75 + 0.25 * v;
    for (let pxx = Math.max(0, Math.floor(sx)); pxx < Math.min(c.w, Math.ceil(sx + ww)); pxx++) {
      const i = py * c.w + pxx;
      if (c.plane[i] !== PLANE.FLOOR) continue;
      const u = (pxx + 0.5 - sx) / ww;
      let e = 1;
      if (u < 0.04 || u > 0.96 || v < 0.06 || v > 0.94) e = 0.55;
      if (Math.abs(u - 0.5) < 0.025 || Math.abs(v - 0.45) < 0.05) e = 0.2;
      const f = k * e * fade;
      c.light[i * 3] += f * rgb[0]; c.light[i * 3 + 1] += f * rgb[1]; c.light[i * 3 + 2] += f * rgb[2];
    }
  }
}
