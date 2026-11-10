// WhoNotSleep renderer — beds: bunk bed with string lights, futons, sleepers under quilts.
import { P } from './palette.js';
import { PLANE, rect, px, hline, vline, gpx, shade, blobShadow } from './canvas.js';

export const SLOT_LEN = 20;

/** y of the mattress top for a slot */
export const bedY = (slot) => (slot.kind === 'futon' ? slot.y + 2 : slot.y);

/** head-top anchor (for badges / overlays) of a sleeper in slot */
export const sleeperHeadTop = (slot) => ({ x: slot.x + 3, y: bedY(slot) - 9 });

/**
 * Bunk bed: two tiers, ladder in the middle, warm string lights on each tier.
 * Returns light sources for the lighting pass.
 */
export function drawBunk(c, plan, t, lightsOn) {
  const b = plan.bunk;
  if (!b) return [];
  const x = b.x, w = 50;
  // back panels (darker wood) behind each tier
  for (const yy of [b.upper, b.lower]) {
    const ph = yy === b.upper ? yy - b.top - 2 : 12;
    rect(c, x + 2, yy - ph, w - 4, ph, P.w2, PLANE.FRONT);
    for (let k = x + 6; k < x + w - 4; k += 7) vline(c, k, yy - ph + 1, ph - 1, P.w1, PLANE.FRONT);
    hline(c, x + 2, yy - ph, w - 4, P.w3, PLANE.FRONT);
    shade(c, x + 2, yy - ph, w - 4, ph, 0.8);
  }
  // mattresses + frame boards
  for (const yy of [b.upper, b.lower]) {
    rect(c, x + 2, yy, w - 4, 2, P.frost, PLANE.TOP);
    hline(c, x + 2, yy + 2, w - 4, P.mist, PLANE.FRONT);
    rect(c, x + 1, yy + 3, w - 2, 4, P.w3, PLANE.FRONT);
    hline(c, x + 1, yy + 3, w - 2, P.w5, PLANE.FRONT);
    hline(c, x + 1, yy + 6, w - 2, P.w2, PLANE.FRONT);
    shade(c, x + 2, yy + 7, w - 4, 3, 0.55);
  }
  // posts
  for (const px0 of [x, x + w - 3]) {
    rect(c, px0, b.top, 3, b.foot - b.top, P.w4, PLANE.FRONT);
    vline(c, px0, b.top, b.foot - b.top, P.w5, PLANE.FRONT);
    vline(c, px0 + 2, b.top, b.foot - b.top, P.w2, PLANE.FRONT);
    rect(c, px0, b.top - 1, 3, 1, P.w5, PLANE.FRONT);
  }
  hline(c, x, b.top + 1, w, P.w4, PLANE.FRONT);
  hline(c, x, b.top + 2, w, P.w2, PLANE.FRONT);
  // ladder in the middle, between the two slots
  const lx = x + 23;
  vline(c, lx, b.upper + 3, b.foot - b.upper - 3, P.w4, PLANE.FRONT);
  vline(c, lx + 3, b.upper + 3, b.foot - b.upper - 3, P.w4, PLANE.FRONT);
  for (let yy = b.upper + 9; yy < b.foot - 1; yy += 5) if (yy < b.lower - 1 || yy > b.lower + 7) hline(c, lx, yy, 4, P.w5, PLANE.FRONT);
  // drawers under the lower bunk
  const dy = b.lower + 8;
  if (b.foot - dy > 5) {
    for (let k = 0; k < 2; k++) {
      const dx = x + 4 + k * 24;
      rect(c, dx, dy + 1, 19, b.foot - dy - 2, P.w2, PLANE.FRONT);
      rect(c, dx + 1, dy + 2, 17, b.foot - dy - 4, P.w3, PLANE.FRONT);
      hline(c, dx + 7, dy + 3, 4, P.w5, PLANE.FRONT);
    }
  }
  blobShadow(c, x + 25, b.foot, 30, 3, 0.45);
  // string lights draped under the top rail and under the upper bunk frame
  const lights = [];
  const cols = [P.a3, P.p3, P.a4, P.t4];
  for (const [yy, tier] of [[b.top + 3, 0], [b.upper + 7, 1]]) {
    for (let xx = x + 3; xx < x + w - 3; xx++) {
      const u = (xx - x - 3) / 22;
      const sag = Math.round(Math.abs(Math.sin(u * Math.PI)) * 2);
      px(c, xx, yy + sag, P.g1, PLANE.FRONT);
      if ((xx - x) % 4 === 1) {
        const n = (xx - x) >> 2;
        const tw = 0.8 + 0.25 * Math.sin(t / 650 + n * 1.9 + tier);
        gpx(c, xx, yy + sag + 1, cols[(n + tier) % 4], 1.0 * tw);
      }
    }
    for (const lx2 of [x + 12, x + 38]) lights.push({ x: lx2, y: yy + (tier ? 8 : 5), r: 28, rgb: [1.0, 0.72, 0.5], k: lightsOn ? (tier ? 1.1 : 0.8) : 0.2 });
  }
  return lights;
}

/** futon on the floor or a single bed (small layout) */
export function drawFutonBase(c, slot) {
  const { x, y, kind } = slot;
  if (kind === 'bed') {
    rect(c, x - 1, y - 12, 3, 22, P.w4, PLANE.FRONT); vline(c, x - 1, y - 12, 22, P.w5, PLANE.FRONT);
    rect(c, x - 1, y - 13, 3, 1, P.w5, PLANE.FRONT);
    rect(c, x + 2, y, 26, 2, P.frost, PLANE.TOP);
    hline(c, x + 2, y + 2, 26, P.mist, PLANE.FRONT);
    rect(c, x, y + 3, 30, 5, P.w3, PLANE.FRONT);
    hline(c, x, y + 3, 30, P.w5, PLANE.FRONT);
    hline(c, x, y + 7, 30, P.w2, PLANE.FRONT);
    rect(c, x + 28, y - 4, 3, 14, P.w4, PLANE.FRONT); vline(c, x + 28, y - 4, 14, P.w5, PLANE.FRONT);
    blobShadow(c, x + 15, y + 10, 18, 2, 0.45);
    return;
  }
  // cream cotton futon: soft top, tufted piping on the front face, rounded corners
  const L2 = SLOT_LEN + 2;
  rect(c, x - 1, y + 2, L2, 3, P.g5, PLANE.TOP);
  hline(c, x, y + 2, L2 - 2, P.white, PLANE.TOP);
  rect(c, x - 1, y + 5, L2, 2, P.g4, PLANE.FRONT);
  for (let q = 2; q < L2 - 1; q += 4) px(c, x - 1 + q, y + 5, P.g3, PLANE.FRONT); // tufts
  hline(c, x - 1, y + 7, L2, P.g2, PLANE.FRONT);
  px(c, x - 1, y + 2, P.g4, PLANE.TOP); px(c, x + L2 - 2, y + 2, P.g4, PLANE.TOP);
  px(c, x - 1, y + 7, P.ink1, PLANE.FRONT); px(c, x + L2 - 2, y + 7, P.ink1, PLANE.FRONT);
  blobShadow(c, x + SLOT_LEN / 2, y + 8, 13, 2, 0.5);
}

// [light, patch A, patch B, shadow]
const QUILTS = [
  [P.r4, P.r3, P.r2, P.r1], [P.t4, P.t3, P.t2, P.t1], [P.v4, P.v3, P.v2, P.v1], [P.a3, P.a2, P.a1, P.w3],
];

const PILLOW = ['.wwwww.', 'wwwwwww', 'fffffff'];
export function pillow(c, x, by) {
  for (let r = 0; r < 3; r++) for (let q = 0; q < 7; q++) {
    const ch = PILLOW[r][q];
    if (ch !== '.') px(c, x + q, by - 3 + r, ch === 'w' ? P.white : P.frost, PLANE.FRONT);
  }
}

/** empty bed: pillow + neatly folded quilt at the foot */
export function drawEmptyBed(c, slot) {
  const by = bedY(slot), x = slot.x;
  pillow(c, x, by);
  // folded patchwork quilt at the foot, colour picked per slot so a row of beds isn't uniform
  const Q = QUILTS[((slot.x * 7 + slot.y * 3) >> 2) % QUILTS.length];
  const fx = x + SLOT_LEN - 10, drape = slot.kind === 'futon';
  for (let r = 0; r < 4; r++) for (let q = 0; q < 10; q++) {
    let col = r === 0 ? Q[0] : r === 3 ? Q[3] : ((q >> 1) + r) & 1 ? Q[1] : Q[2];
    if (r === 1 && (q === 0 || q === 9)) col = Q[2];
    px(c, fx + q, by - 3 + r, col, r === 0 ? PLANE.TOP : PLANE.FRONT);
  }
  if (drape) { // corner spilling over the mattress edge
    for (let r = 0; r < 3; r++) for (let q = 0; q < 3 - r; q++) px(c, fx + 7 + q + r, by + 1 + r, r === 2 ? Q[3] : Q[2], PLANE.FRONT);
  }
}

/** little paper-star lantern hanging on a string */
export function drawNightlight(c, x, y, on, t) {
  const sway = Math.round(Math.sin(t / 1500) * 0.6);
  for (let k = 0; k < 4; k++) px(c, x + 1, y - 4 + k, P.g2, PLANE.FRONT);
  const S = ['.a.', 'aAa', '.a.', 'a.a'];
  for (let yy = 0; yy < 4; yy++) for (let xx = 0; xx < 3; xx++) {
    const ch = S[yy][xx];
    if (ch === '.') continue;
    if (on) gpx(c, x + xx + sway, y + yy, ch === 'A' ? P.a4 : P.a3, ch === 'A' ? 1.5 : 1.0);
    else px(c, x + xx + sway, y + yy, P.a1, PLANE.FRONT);
  }
}
