// WhoNotSleep renderer — ambient life: Zzz, mug steam, dust motes, the night cat.
import { P } from './palette.js';
import { PLANE, opx, gpx, addEmit, sprite, blit, hash2 } from './canvas.js';

/** floating Zzz drifting up-right from a sleeper; letters grow and fade as they rise */
export function drawZzz(c, x, y, t, phase = 0) {
  for (let k = 0; k < 3; k++) {
    const p = ((t / 1500 + phase + k / 3) % 1);
    const zx = Math.round(x + p * 5 + Math.sin(p * 6.3 + phase * 5) * 1.3), zy = Math.round(y - p * 11);
    const col = p > 0.78 ? P.ink6 : p > 0.5 ? P.mist : P.frost;
    if (p > 0.45) { // 4x4 Z
      for (let q = 0; q < 4; q++) { opx(c, zx + q, zy, col); opx(c, zx + q, zy + 3, col); }
      opx(c, zx + 2, zy + 1, col); opx(c, zx + 1, zy + 2, col);
    } else {        // 3x3 z
      opx(c, zx, zy, col); opx(c, zx + 1, zy, col); opx(c, zx + 2, zy, col);
      opx(c, zx + 1, zy + 1, col);
      opx(c, zx, zy + 2, col); opx(c, zx + 1, zy + 2, col); opx(c, zx + 2, zy + 2, col);
    }
  }
}

/** steam from a mug: faint emissive wisps curling upward */
export function drawSteam(c, x, y, t, k = 0.25) {
  for (let i = 0; i < 5; i++) {
    const p = ((t / 1000 + i / 5) % 1);
    const sx = Math.round(x + Math.sin(p * 6 + i * 1.3) * 1.1), sy = Math.round(y - p * 7);
    const a = Math.sin(p * Math.PI) * k;
    addEmit(c, sx, sy, a * 0.85, a * 0.85, a * 0.95);
  }
}

/** dust motes drifting inside the window light shaft (sparkle when they cross the beam core) */
export function drawDust(c, win, slope, bottom, rgb, k, t) {
  for (let i = 0; i < 18; i++) {
    const u = hash2(i, 1, 3) * win.w;
    const p = (hash2(i, 2, 3) + t / (11000 + hash2(i, 4) * 9000)) % 1;
    const yy = win.y + win.h + p * (bottom - win.y - win.h);
    const xx = win.x + u + slope * (yy - win.y - win.h) + Math.sin(t / 1300 + i * 2.1) * 1.8;
    const tw = 0.45 + 0.55 * Math.max(0, Math.sin(t / 420 + i * 3.7));
    const a = k * tw * (1 - p * 0.75);
    addEmit(c, Math.round(xx), Math.round(yy), rgb[0] * a, rgb[1] * a, rgb[2] * a);
  }
}

// cat sprites (11x7): walk frames + sitting with tail
const CAT_WALK = [
  ['k...k......', 'kk.kk......', 'kkkkk.....k', 'kykyk....k.', 'kkkkkkkkkk.', '.kkkkkkkkk.', '.k.k...k.k.'],
  ['k...k......', 'kk.kk......', 'kkkkk......', 'kykyk.....k', 'kkkkkkkkkk.', '.kkkkkkkkk.', 'k...k.k...k'],
];
const CAT_SIT = [
  ['k...k....', 'kk.kk....', 'kkkkk....', 'kykyk....', '.kkkk....', '.kkkkk..k', '.kkkkkkk.'],
  ['k...k....', 'kk.kk....', 'kkkkk....', 'kkkkk....', '.kkkk....', '.kkkkk...', '.kkkkkkkk'],
];
const CAT_L = { k: 'ink1', y: 'y2' };

/**
 * A black cat that strolls across the floor at night every ~45s. Direction alternates per
 * visit and it sometimes stops mid-room to sit, blink and swish its tail.
 */
export function drawCat(c, W, y, t, x0 = 0) {
  const period = 45000, walk = 15000, sit = 4000;
  const cyc = Math.floor(t / period), ph = t % period;
  const sits = hash2(cyc, 7) > 0.35;
  const total = walk + (sits ? sit : 0);
  if (ph > total) return;
  const dir = cyc & 1 ? -1 : 1;
  const stopAt = 0.35 + hash2(cyc, 9) * 0.3;
  let u, sitting = false;
  if (!sits) u = ph / walk;
  else {
    const half = walk * stopAt;
    if (ph < half) u = ph / walk;
    else if (ph < half + sit) { u = stopAt; sitting = true; }
    else u = (ph - sit) / walk;
  }
  const span = W - x0 + 24;
  const x = Math.round(dir > 0 ? x0 - 12 + u * span : W + 12 - u * span);
  const f = Math.floor(t / 220) % 2;
  const flip = dir < 0;
  if (sitting) {
    const blink = Math.floor(t / 150) % 14 === 0;
    const swish = Math.floor(t / 500) % 2;
    const spr = sprite(CAT_SIT[blink ? 1 : swish], CAT_L);
    blit(c, spr, x, y - 7, { plane: PLANE.CHAR, flip });
    if (!blink) { const ex = flip ? x + 5 : x + 1; gpx(c, ex, y - 4, P.y2, 0.8); gpx(c, ex + 2, y - 4, P.y2, 0.8); }
    return;
  }
  blit(c, sprite(CAT_WALK[f], CAT_L), x, y - 7, { plane: PLANE.CHAR, flip });
  const ex = flip ? x + 11 - 4 : x + 1;
  gpx(c, ex, y - 4, P.y2, 0.7); gpx(c, ex + 2, y - 4, P.y2, 0.7);
}
