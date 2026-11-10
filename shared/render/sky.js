// WhoNotSleep renderer — window view: sky gradient by hour, stars, moon, sun,
// clouds and the city skyline with lit windows at night.
import { P, PAL } from './palette.js';
import { PLANE, hash2 } from './canvas.js';

function skyStops(h) {
  if (h >= 20.5 || h < 4.5) return [P.ink0, P.ink1, P.ink2, P.ink3, P.v0, P.v1];
  if (h < 5.5) return [P.ink1, P.ink2, P.v1, P.v2, P.p2];
  if (h < 7.5) return [P.v1, P.v2, P.p2, P.r3, P.r4, P.a3];
  if (h < 9) return [P.b2, P.b3, P.b4, P.frost];
  if (h < 16.5) return [P.b2, P.b3, P.b3, P.b4];
  if (h < 18) return [P.b2, P.b3, P.b4, P.a3, P.a2];
  if (h < 19.2) return [P.v1, P.v2, P.p2, P.r3, P.o2, P.a2];
  return [P.ink1, P.v0, P.v1, P.r1, P.r2];
}

const BAY = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

// write a sky pixel: unaffected by room light (occ=0), self-emissive
function sp(c, x, y, idx, k = 1) {
  const X = (x + c.ox) | 0, Y = (y + c.oy) | 0;
  if (X < 0 || Y < 0 || X >= c.w || Y >= c.h) return;
  const i = Y * c.w + X;
  c.alb[i] = idx; c.plane[i] = PLANE.SKY; c.occ[i] = 0;
  c.emit[i * 3] = PAL[idx * 3] / 255 * k;
  c.emit[i * 3 + 1] = PAL[idx * 3 + 1] / 255 * k;
  c.emit[i * 3 + 2] = PAL[idx * 3 + 2] / 255 * k;
}
function glow(c, x, y, idx, k) {
  const X = (x + c.ox) | 0, Y = (y + c.oy) | 0;
  if (X < 0 || Y < 0 || X >= c.w || Y >= c.h) return;
  const i = Y * c.w + X;
  c.alb[i] = idx;
  c.emit[i * 3] += PAL[idx * 3] / 255 * k; c.emit[i * 3 + 1] += PAL[idx * 3 + 1] / 255 * k; c.emit[i * 3 + 2] += PAL[idx * 3 + 2] / 255 * k;
}

const MOON = ['.###.', '##..#', '#....', '##..#', '.###.']; // crescent; '.' inside = shadowed disc
const MOON_FULL = ['..###..', '.#####.', '###.###', '#######', '##.####', '.#####.', '..###..'];

/**
 * Draw the outside view into rect (x,y,w,h). tod = timeOfDay(hour). t = ms.
 * seed varies the skyline per room code.
 */
export function drawSky(c, x, y, w, h, tod, t, seed = 7) {
  const stops = skyStops(tod.hour);
  const n = stops.length - 1;
  const skyK = tod.phase === 'night' ? 0.9 : 1.0;
  for (let yy = 0; yy < h; yy++) {
    const f = n * yy / Math.max(1, h - 1);
    const k = Math.min(n - 1, Math.floor(f));
    let fr = (f - k - 0.5) * 2.2 + 0.5; fr = fr < 0 ? 0 : fr > 1 ? 1 : fr;
    for (let xx = 0; xx < w; xx++) {
      const th = (BAY[((yy & 3) << 2) | (xx & 3)] + 0.5) / 16;
      sp(c, x + xx, y + yy, th < fr ? stops[k + 1] : stops[k], skyK);
    }
  }
  // stars
  if (tod.stars > 0.05) {
    for (let s = 0; s < 22; s++) {
      const sx = (hash2(s, 1, seed) * w) | 0, sy = (hash2(s, 2, seed) * h * 0.62) | 0;
      if (hash2(s, 3, seed) > tod.stars) continue;
      const tw = Math.sin(t / (380 + hash2(s, 4) * 900) + s * 1.7);
      const big = hash2(s, 5, seed) > 0.85;
      const col = tw > 0.6 ? P.white : tw > -0.2 ? P.frost : P.mist;
      if (tw < -0.75 && !big) continue;
      glow(c, x + sx, y + sy, col, (big ? 0.9 : 0.5) * tod.stars);
      if (big && tw > 0.3) {
        glow(c, x + sx - 1, y + sy, P.mist, 0.35); glow(c, x + sx + 1, y + sy, P.mist, 0.35);
        glow(c, x + sx, y + sy - 1, P.mist, 0.35); glow(c, x + sx, y + sy + 1, P.mist, 0.35);
      }
    }
  }
  // moon arcs across the window during the night
  if (tod.moon > 0.05) {
    const p = Math.min(1, Math.max(0, tod.moonP));
    const mx = x + 4 + Math.round(p * (w - 13)), my = y + 3 + Math.round(Math.pow(Math.abs(p - 0.45) * 2, 2) * h * 0.25);
    for (let yy = 0; yy < 7; yy++) for (let xx = 0; xx < 7; xx++) {
      if (MOON_FULL[yy][xx] === '.') continue;
      const lit = xx + yy * 0.3 > 3.2;
      const cx = mx + xx, cy = my + yy;
      if (lit) glow(c, cx, cy, xx > 4 && yy < 3 ? P.white : P.a4, 1.25 * tod.moon);
      else glow(c, cx, cy, P.ink4, 0.25 * tod.moon);
    }
    glow(c, mx + 4, my + 4, P.a3, 0.4 * tod.moon); // crater
  }
  // sun low in the window at dawn / dusk
  if (tod.sun > 0.05 && (tod.phase === 'dawn' || tod.phase === 'dusk')) {
    const p = Math.min(1, Math.max(0, tod.sunP));
    const sx = x + 3 + Math.round(p * (w - 10)), sy = y + h - 14 + (tod.phase === 'dusk' ? 4 : 2);
    const col = tod.phase === 'dusk' ? P.a3 : P.a4;
    for (let yy = -3; yy <= 3; yy++) for (let xx = -3; xx <= 3; xx++) {
      if (xx * xx + yy * yy > 10) continue;
      if (sy + yy < y || sy + yy >= y + h) continue;
      glow(c, sx + xx, sy + yy, xx * xx + yy * yy < 4 ? P.white : col, 1.3 * tod.sun);
    }
  }
  // clouds: soft puffs drifting
  const day = tod.phase === 'day' || tod.phase === 'dawn' || tod.phase === 'dusk';
  const cloudHi = tod.phase === 'day' ? P.white : tod.phase === 'dusk' ? P.r4 : tod.phase === 'dawn' ? P.r4 : P.ink4;
  const cloudLo = tod.phase === 'day' ? P.frost : tod.phase === 'dusk' ? P.p2 : tod.phase === 'dawn' ? P.p3 : P.ink3;
  for (let k = 0; k < 3; k++) {
    const cw = 9 + ((hash2(k, 9, seed) * 8) | 0);
    const span = w + cw + 4;
    const cx = x - cw + ((((hash2(k, 7, seed) * span) + t / (5200 + k * 2100)) % span) | 0);
    const cy = y + 4 + ((hash2(k, 8, seed) * h * 0.45) | 0);
    for (let xx = 0; xx < cw; xx++) {
      const X = cx + xx;
      if (X < x || X >= x + w) continue;
      const bump = Math.round(Math.sin((xx / cw) * Math.PI) * 2.6 + (xx % 4 === 1 ? 0.6 : 0));
      for (let yy = -bump; yy <= 1; yy++) {
        if (cy + yy < y || cy + yy >= y + h) continue;
        sp(c, X, cy + yy, yy >= 1 ? cloudLo : yy === -bump ? (day ? P.white : cloudHi) : cloudHi, day ? 1 : 0.8);
      }
    }
  }
  drawSkyline(c, x, y, w, h, tod, t, seed);
}

function drawSkyline(c, x, y, w, h, tod, t, seed) {
  const night = tod.city;
  const far = tod.phase === 'day' ? P.b3 : tod.phase === 'dawn' ? P.v2 : tod.phase === 'dusk' ? P.v2 : P.ink2;
  const near = tod.phase === 'day' ? P.ink6 : tod.phase === 'dawn' ? P.v1 : tod.phase === 'dusk' ? P.v1 : P.ink1;
  const edge = tod.phase === 'day' ? P.ink7 : tod.phase === 'night' ? P.ink3 : P.v2;
  // far layer
  let xx = 0, b = 0;
  while (xx < w) {
    const bw = 3 + ((hash2(b, 11, seed) * 5) | 0), bh = 5 + ((hash2(b, 12, seed) * 8) | 0);
    for (let i = 0; i < bw && xx + i < w; i++) for (let j = 0; j < bh; j++) sp(c, x + xx + i, y + h - 1 - j, far, 0.85);
    xx += bw; b++;
  }
  // near layer with lit windows
  xx = 0; b = 0;
  while (xx < w) {
    const bw = 4 + ((hash2(b, 21, seed) * 6) | 0), bh = 3 + ((hash2(b, 22, seed) * 9) | 0);
    for (let i = 0; i < bw && xx + i < w; i++) for (let j = 0; j < bh; j++) {
      const X = x + xx + i, Y = y + h - 1 - j;
      sp(c, X, Y, j === bh - 1 || i === 0 ? edge : near, 0.9);
      if (night > 0.05 && i > 0 && i < bw - 1 && j < bh - 2 && (i & 1) === 1 && (j % 2) === 1) {
        const r = hash2(X, Y, seed);
        // windows switch on/off slowly
        const on = r < 0.42 * night + 0.1 * Math.sin(t / 9000 + r * 40);
        if (on) glow(c, X, Y, r < 0.12 ? P.frost : r < 0.3 ? P.a4 : P.a3, 0.8 * night);
      }
    }
    // antenna with a blinking red light
    if (bh > 9 && hash2(b, 23, seed) > 0.4) {
      for (let j = 0; j < 2; j++) sp(c, x + xx + (bw >> 1), y + h - 1 - bh - j, near, 0.9);
      if (night > 0.3 && Math.floor(t / 900 + b) % 2 === 0) glow(c, x + xx + (bw >> 1), y + h - 2 - bh - 1, P.r3, 1.4);
    }
    xx += bw + ((hash2(b, 24, seed) * 2) | 0); b++;
  }
}
