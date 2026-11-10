// WhoNotSleep renderer — avatar portrait (big cute bust) for the avatar picker.
// 32x32 base, procedurally shaped head / hair / accessories, lit + palette-quantized.
import { P, PAL, quantize } from './palette.js';
import { createCanvas, clearCanvas, px, gpx, outline, PLANE } from './canvas.js';
import { addLight, compose, rimLight } from './lighting.js';
import { avatarColors } from './avatar.js';

const B = 32, CH = PLANE.CHAR, ID = 1;
const SPIKES = [9, 3, 13, 1, 18, 1, 22, 3, 25, 7, 6, 7];
let PC = null;

const inEll = (x, y, cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
const set = (c, x, y, col) => px(c, x, y, col, CH, ID);

// ------------------------------------------------------------------ shapes
function face(x, y) { // rounded chibi head with soft cheeks
  if (y < 6 || y > 23) return false;
  if (y <= 17) return inEll(x + 0.5, y + 0.5, 16, 15, 9.6, 9.6);
  return inEll(x + 0.5, y + 0.5, 16, 15.5, 9.6 - (y - 17) * 0.35, 8.6);
}
function cap(x, y, k) { return inEll(x + 0.5, y + 0.5, 16, 13.2, 10.8, k.style === 5 ? 8.6 : 9.8); }

/** hair coverage: 0 none, 1 behind face, 2 over face. */
function hairAt(x, y, k) {
  const s = k.style;
  const top = cap(x, y, k);
  if (s === 0) { // messy short: jagged fringe + tufts
    if ((x === 13 || x === 14) && y === 2) return 2;
    if (x === 19 && (y === 2 || y === 3)) return 2;
    const fr = 11 + ((x * 5) % 3) - (x > 18 ? 1 : 0);
    if (top && y < fr) return 2;
    if ((x === 6 || x === 25) && y >= 12 && y <= 17) return 2;
    return 0;
  }
  if (s === 1) { // long straight
    if (top && y < 11 + (x === 16 || x === 15 ? -2 : 0) + ((x & 3) === 0 ? 1 : 0)) return 2;
    if ((x >= 5 && x <= 7) || (x >= 24 && x <= 26)) { if (y >= 10 && y <= 30 - ((x === 5 || x === 26) ? 2 : 0)) return 2; }
    if (x >= 5 && x <= 26 && y >= 9 && y <= 26) return 1;
    return 0;
  }
  if (s === 2) { // spiky
    for (let j = 0; j < SPIKES.length; j += 2) {
      const dx = Math.abs(x - SPIKES[j]), dy = y - SPIKES[j + 1];
      if (dy >= 0 && dy <= 4 && dx <= dy * 0.6) return 2;
    }
    const fr = 12 + ((x % 3) === 1 ? 2 : (x % 3) === 2 ? 1 : 0);
    if (top && y < fr) return 2;
    return 0;
  }
  if (s === 3) { // bob with blunt fringe
    if (top && y < 12) return 2;
    if ((x <= 8 && x >= 5) || (x >= 23 && x <= 26)) { if (y >= 9 && y <= 22 - (x === 5 || x === 26 ? 1 : 0)) return 2; }
    return 0;
  }
  if (s === 4) { // top bun + side-swept fringe
    if (inEll(x + 0.5, y + 0.5, 16, 3.5, 3.6, 3)) return 2;
    if (top && y < 8 + Math.max(0, (x - 9) * 0.45) && x < 24) return 2;
    if (top && y < 9) return 2;
    if ((x === 6 || x === 25) && y >= 9 && y <= 15) return 2;
    return 0;
  }
  // buzz
  if (top && y < 9) return 2;
  if ((x === 7 || x === 24) && y >= 9 && y <= 13) return 2;
  return 0;
}

function hairCol(x, y, k) {
  const d = Math.hypot(x + 0.5 - 16, y + 0.5 - 13);
  if (y < 10 && d > 6.2 && d < 7.6 && x > 8 && x < 17) return k.hairL;      // angel-ring sheen
  if (x >= 22 || (y >= 10 && x >= 20)) return k.hairD;                     // shadow side
  if (k.style === 5 && ((x + y) & 1)) return k.hairD;                      // buzz texture
  return k.hair;
}

// ------------------------------------------------------------------ portrait
export function renderAvatar(avatar, opts) {
  opts = opts || {};
  let t = +opts.t;
  t = t === t && Math.abs(t) !== Infinity ? ((t % 1e9) + 1e9) % 1e9 : 0;
  const size = Math.min(512, Math.max(16, opts.size | 0 || 32));
  if (!PC) PC = createCanvas(B, B);
  const c = PC;
  clearCanvas(c, P.ink2);
  const k = avatarColors(avatar);
  // backdrop: night-blue disc, faint stars
  for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) {
    const d = Math.hypot(x - 15.5, y - 13);
    px(c, x, y, d < 11 ? P.ink4 : d < 15 ? P.ink3 : P.ink2, PLANE.WALL);
  }
  for (const [sx, sy, kk] of [[3, 4, 0.7], [28, 6, 0.5], [26, 2, 0.6], [5, 25, 0.35], [29, 21, 0.4]]) {
    const tw = 0.6 + 0.4 * Math.sin(t / 500 + sx);
    gpx(c, sx, sy, P.frost, kk * tw);
  }
  const bob = Math.floor(t / 1400) % 2;            // breathing
  const blink = Math.floor(t / 110) % 34 === 0;
  // back hair, body, face
  for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) if (hairAt(x, y - bob, k) === 1) set(c, x, y, x >= 20 ? k.hairD : k.hair);
  for (let y = 23; y < B; y++) for (let x = 0; x < B; x++) { // shoulders
    const half = 5 + Math.min(6, (y - 23) * 1.6);
    if (Math.abs(x + 0.5 - 16) > half) continue;
    let col = x > 20 ? k.shirtD : k.shirt;
    if (y === 23 + Math.floor(Math.abs(x + 0.5 - 16) / 1.6)) col = k.shirtL; // shoulder ridge highlight
    set(c, x, y, col);
  }
  for (let y = 21; y < 26; y++) for (let x = 14; x < 18; x++) set(c, x, y, y < 23 ? k.skinD : k.skin); // neck
  if (k.hoodie) { set(c, 13, 25, P.frost); set(c, 18, 25, P.frost); set(c, 13, 26, P.mist); set(c, 18, 27, P.mist); for (let x = 11; x < 21; x++) if (x < 14 || x > 17) set(c, x, 24, k.shirtD); }
  else { set(c, 14, 26, k.skinD); set(c, 15, 27, k.skin); set(c, 16, 27, k.skin); set(c, 17, 26, k.skinD); set(c, 13, 25, k.shirtL); set(c, 18, 25, k.shirtL); }
  for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) {
    if (!face(x, y - bob)) continue;
    let col = k.skin;
    if (x >= 22 || (y - bob >= 21 && x >= 19)) col = k.skinD;
    if (y - bob >= 22) col = k.skinD;
    set(c, x, y, col);
  }
  const fy = bob;
  set(c, 10, 9 + fy, k.skinL); set(c, 11, 8 + fy, k.skinL); // forehead sheen (mostly under fringe)
  // eyes: 3x4 with lash, iris + double glint
  const iris = k.skinI >= 3 ? P.v2 : [P.b2, P.v1, P.t1, P.w2][(avatar?.hair | 0) & 3];
  for (const ex of [9, 20]) {
    if (blink) { for (let q = -1; q < 3; q++) set(c, ex + q, 16 + fy, k.eye); set(c, ex + (ex < 16 ? -1 : 2), 15 + fy, k.eye); continue; }
    for (let q = -1; q < 4; q++) if (!(q === -1 && ex > 16) && !(q === 3 && ex < 16)) set(c, ex + q, 13 + fy, k.eye); // lash
    for (let r = 0; r < 4; r++) for (let q = 0; q < 3; q++) set(c, ex + q, 14 + r + fy, r < 2 ? k.eye : iris);
    set(c, ex + 2, 17 + fy, P.ink3);
    set(c, ex, 14 + fy, P.white); set(c, ex + 1, 14 + fy, P.white); set(c, ex, 15 + fy, P.white);
    set(c, ex + 2, 16 + fy, P.frost);
  }
  // brows peeking under fringe, nose, mouth, blush
  set(c, 16, 18 + fy, k.skinD);
  const m = k.skinI >= 3 ? P.r1 : P.r2;
  set(c, 15, 20 + fy, m); set(c, 16, 20 + fy, m); set(c, 14, 19 + fy, k.skinD); set(c, 17, 19 + fy, k.skinD);
  if (k.skinI < 3) set(c, 16, 21 + fy, P.r3);
  for (const bx of [7, 22]) { set(c, bx, 19 + fy, k.blush); set(c, bx + 1, 19 + fy, k.blush); set(c, bx + (bx < 16 ? 1 : 0), 20 + fy, k.skinI >= 3 ? k.skin : P.r4); }
  // front hair
  for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) {
    const h = hairAt(x, y - bob, k);
    if (h !== 2) continue;
    if (k.acc === 3 && y - bob < 10) continue;
    set(c, x, y, hairCol(x, y - bob, k));
  }
  accessories(c, k, bob);
  outline(c, 0, 0, B, B, ID, P.ink0);
  // light: crisp hand shading stays (neutral ambient); warm lamp rim on the left edge, cool monitor rim on the right
  rimLight(c, 0, 0, B, B, ID, -1, [1.0, 0.8, 0.55], 0.22);
  rimLight(c, 0, 0, B, B, ID, 1, [0.5, 0.75, 1.0], 0.38);
  addLight(c, { x: 4, y: 4, r: 16, rgb: [1.0, 0.8, 0.6], k: 0.12, floorSquash: 1 });
  compose(c, [1.02, 1.0, 1.04], 0.5, null);
  c.spread.fill(0); // portraits stay clean: flat cel shading, no falloff dither
  quantize(B, B, c.col, c.spread, 0, c.qidx, c.rgba);
  return upscale(c.rgba, size);
}

function accessories(c, k, bob) {
  const fy = bob;
  if (k.acc === 1) { // round glasses
    const fr = k.skinI >= 4 ? P.g5 : P.g1;
    for (const cx of [10.5, 21]) for (let y = 11; y < 21; y++) for (let x = cx - 5; x < cx + 5; x++) {
      const d = Math.hypot(x + 0.5 - cx, (y + 0.5 - 15.8) * 1.05);
      if (d > 3.1 && d < 4.1) set(c, x | 0, y + fy, fr);
    }
    for (let x = 14; x < 17; x++) set(c, x, 15 + fy, fr);
    set(c, 12, 17 + fy, P.frost); set(c, 23, 17 + fy, P.frost);
  } else if (k.acc === 2) { // headphones
    for (let y = 0; y < 14; y++) for (let x = 0; x < B; x++) {
      const d = Math.hypot(x + 0.5 - 16, (y + 0.5 - 13) * 1.05);
      if (d > 11 && d < 12.6 && y < 13) set(c, x, y + fy, x < 14 ? P.g3 : P.g2);
    }
    for (const ex of [3, 25]) for (let y = 12; y < 21; y++) for (let x = ex; x < ex + 4; x++) {
      if ((y === 12 || y === 20) && (x === ex || x === ex + 3)) continue;
      set(c, x, y + fy, x === ex + (ex < 16 ? 0 : 3) ? P.g1 : (y < 14 ? P.r3 : P.r2));
    }
  } else if (k.acc === 3) { // cap in shirt colour with brim
    for (let y = 1; y < 11; y++) for (let x = 0; x < B; x++) {
      if (!inEll(x + 0.5, y + 0.5, 16, 10, 10.5, 9)) continue;
      set(c, x, y + fy, x >= 21 ? k.shirtD : (x === 11 && y < 7) ? k.shirtL : k.shirt);
    }
    for (let x = 4; x < 26; x++) { set(c, x, 10 + fy, k.shirtDD); set(c, x, 11 + fy, x < 25 ? k.shirtD : k.shirtDD); }
    for (let x = 7; x < 25; x++) set(c, x, 12 + fy, k.skinD); // brim shadow
    set(c, 16, 1 + fy, k.shirtL); set(c, 15, 5 + fy, P.white); set(c, 16, 5 + fy, P.white);
  } else if (k.acc === 4) { // cat ears
    for (const [ex, dir] of [[8, 1], [23, -1]]) for (let r = 0; r < 6; r++) for (let q = 0; q <= r; q++) {
      const x = ex + dir * (q - (r >> 1)), y = 1 + r;
      const inner = r >= 2 && q > 0 && q < r;
      set(c, x, y + fy, inner ? (r > 3 ? P.p2 : P.p3) : r > 3 ? k.hairD : k.hair);
    }
  }
}

function upscale(src, size) {
  const out = new Uint8ClampedArray(size * size * 4);
  const scale = size >= B ? Math.floor(size / B) : 0;
  const bg = P.ink2 * 3;
  for (let i = 0; i < size * size; i++) { out[i * 4] = PAL[bg]; out[i * 4 + 1] = PAL[bg + 1]; out[i * 4 + 2] = PAL[bg + 2]; out[i * 4 + 3] = 255; }
  const span = scale ? B * scale : size, off = (size - span) >> 1;
  for (let y = 0; y < span; y++) for (let x = 0; x < span; x++) {
    const sx = scale ? (x / scale) | 0 : (x * B / size) | 0, sy = scale ? (y / scale) | 0 : (y * B / size) | 0;
    const s = (sy * B + sx) * 4, d = ((y + off) * size + x + off) * 4;
    out[d] = src[s]; out[d + 1] = src[s + 1]; out[d + 2] = src[s + 2];
  }
  return { width: size, height: size, data: out };
}
