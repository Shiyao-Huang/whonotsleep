// WhoNotSleep renderer — furniture: long desk, monitors, chairs, lamps, mugs, bunk bed, futons.
import { P, PAL } from './palette.js';
import { PLANE, rect, px, hline, vline, gpx, shade, blobShadow, addEmit, hash2 } from './canvas.js';

/** continuous desk counter across the seats */
export function drawDeskCounter(c, plan) {
  const s0 = plan.seats[0], sl = plan.seats[plan.seats.length - 1];
  const x0 = s0.x - 2, x1 = sl.x + sl.w + 1, y = plan.deskY;
  const fh = plan.H === 96 ? 9 : 10;
  rect(c, x0, y, x1 - x0, 1, P.w5, PLANE.TOP);
  rect(c, x0, y + 1, x1 - x0, 2, P.w4, PLANE.TOP);
  rect(c, x0, y + 3, x1 - x0, fh, P.w3, PLANE.FRONT);
  hline(c, x0, y + 3, x1 - x0, P.w2, PLANE.FRONT);
  hline(c, x0, y + 3 + fh - 1, x1 - x0, P.w2, PLANE.FRONT);
  // drawers per seat
  for (const s of plan.seats) {
    rect(c, s.x + 2, y + 5, s.w - 4, fh - 4, P.w2, PLANE.FRONT);
    rect(c, s.x + 3, y + 6, s.w - 6, fh - 6, P.w3, PLANE.FRONT);
    hline(c, s.x + (s.w >> 1) - 2, y + 4 + (fh >> 1), 4, P.w5, PLANE.FRONT);
  }
  vline(c, x0, y + 3, fh, P.w2, PLANE.FRONT); vline(c, x1 - 1, y + 3, fh, P.w2, PLANE.FRONT);
  // legs + floor shadow
  const ly = y + 3 + fh;
  rect(c, x0 + 1, ly, 2, 4, P.w1, PLANE.FRONT); rect(c, x1 - 3, ly, 2, 4, P.w1, PLANE.FRONT);
  shade(c, x0, ly, x1 - x0, 1, 0.35);
  shade(c, x0 - 1, ly + 1, x1 - x0 + 2, 2, 0.55);
  shade(c, x0 - 2, ly + 3, x1 - x0 + 4, 2, 0.8);
  return { x0, x1, frontY: y + 3, bottomY: ly };
}

const BAY = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/**
 * Monitor. state: 'off' | 'saver' | 'ai'. rgb = tool colour (0..255 triple).
 * Returns screen rect for FX (AI sprite etc.).
 */
export function drawMonitor(c, s, deskY, state, rgb, t, seedN) {
  const w = s.monW, h = s.monH, x = s.monX, y = deskY - h - 3;
  // stand
  rect(c, x + (w >> 1) - 1, deskY - 3, 3, 3, P.g2, PLANE.FRONT);
  hline(c, x + (w >> 1) - 3, deskY - 1, 7, P.g1, PLANE.TOP);
  // bezel
  rect(c, x, y, w, h, P.g1, PLANE.FRONT);
  hline(c, x, y, w, P.g2, PLANE.FRONT);
  const sx = x + 1, sy = y + 1, sw = w - 2, sh = h - 2;
  if (state === 'off') {
    rect(c, sx, sy, sw, sh, P.ink0, PLANE.FRONT);
    // glass reflection
    for (let k = 0; k < 3; k++) px(c, sx + sw - 2 - k, sy + k, P.ink3, PLANE.FRONT);
    px(c, sx + sw - 1, sy, P.ink2, PLANE.FRONT);
    // standby LED
    gpx(c, x + w - 2, y + h - 1, P.r3, 0.6);
  } else if (state === 'idle') {
    // desktop: soft wallpaper + a couple of windows (music player / browser)
    for (let yy = 0; yy < sh; yy++) for (let xx = 0; xx < sw; xx++) gpx(c, sx + xx, sy + yy, yy < sh / 2 ? P.ink5 : P.ink4, 0.8, P.ink0);
    for (let yy = 1; yy < sh - 2; yy++) for (let xx = 1; xx < Math.min(sw - 1, 7); xx++) gpx(c, sx + xx, sy + yy, yy === 1 ? P.p3 : P.frost, 0.9, P.ink0);
    const bar = 1 + (Math.floor(t / 400 + seedN) % 4);
    for (let xx = 2; xx < Math.min(sw - 2, 6); xx++) gpx(c, sx + xx, sy + sh - 3 - ((xx * 7 + bar) % 3 === 0 ? 1 : 0), P.v3, 1);
    hlineG(c, sx, sy + sh - 1, sw, P.ink3);
    gpx(c, x + w - 2, y + h - 1, P.t4, 0.6);
  } else if (state === 'saver') {
    // dim navy screen with a bouncing star screensaver
    for (let yy = 0; yy < sh; yy++) for (let xx = 0; xx < sw; xx++) gpx(c, sx + xx, sy + yy, yy < 2 ? P.ink2 : P.ink1, 0.6, P.ink0);
    const T = t / 260 + seedN * 7;
    const bx = Math.round(Math.abs(((T * 0.9) % (2 * (sw - 2))) - (sw - 2)));
    const by = Math.round(Math.abs(((T * 0.6) % (2 * (sh - 2))) - (sh - 2)));
    gpx(c, sx + bx, sy + by, P.v4, 1.2); gpx(c, sx + bx + 1, sy + by, P.v3, 0.8);
    gpx(c, sx + bx, sy + by + 1, P.v3, 0.8); gpx(c, sx + bx + 1, sy + by + 1, P.v2, 0.6);
    gpx(c, x + w - 2, y + h - 1, P.t4, 0.6);
  } else {
    // AI tool screen: tinted background, code lines scrolling on the left half
    const r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
    for (let yy = 0; yy < sh; yy++) for (let xx = 0; xx < sw; xx++) {
      const i = ((sy + yy + c.oy) * c.w + sx + xx + c.ox);
      if (i < 0 || i >= c.n) continue;
      c.alb[i] = P.ink0; c.plane[i] = PLANE.FRONT;
      const vig = 0.34 + 0.1 * (1 - yy / sh);
      addEmit(c, sx + xx, sy + yy, r * vig + 0.03, g * vig + 0.03, b * vig + 0.06);
    }
    const scroll = Math.floor(t / 420);
    const codeW = Math.max(3, sw - 5);
    for (let ln = 0; ln < sh - 1; ln += 2) {
      const n = ln / 2 + scroll + seedN * 13;
      const indent = (hash2(n, 1) * 3) | 0;
      const len = 1 + ((hash2(n, 2) * (codeW - indent)) | 0);
      for (let k = 0; k < len; k++) {
        const cx = sx + 1 + indent + k;
        const hl = hash2(n, k + 9) > 0.7;
        addEmit(c, cx, sy + 1 + ln, hl ? r * 0.9 + 0.1 : 0.55, hl ? g * 0.9 + 0.1 : 0.58, hl ? b * 0.9 + 0.1 : 0.7);
      }
    }
    // blinking cursor
    if (Math.floor(t / 500) % 2 === 0) addEmit(c, sx + 1, sy + sh - 1, 0.9, 0.9, 0.9);
    gpx(c, x + w - 2, y + h - 1, P.t4, 0.8);
  }
  return { x: sx, y: sy, w: sw, h: sh };
}

/** small AI sprite bouncing on the screen in the tool colour */
export function drawAISprite(c, scr, rgb, t, seedN) {
  const r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
  const hop = Math.abs(Math.sin(t / 260 + seedN)) * 2.2;
  const x = scr.x + scr.w - 4, y = scr.y + scr.h - 4 - Math.round(hop);
  const shape = ['.##.', '#oo#', '####'];
  const blink = Math.floor(t / 140 + seedN * 5) % 23 === 0;
  for (let yy = 0; yy < 3; yy++) for (let xx = 0; xx < 4; xx++) {
    const ch = shape[yy][xx];
    if (ch === '.') continue;
    if (ch === 'o' && !blink) addEmit(c, x + xx, y + yy, 0.05, 0.05, 0.1);
    else addEmit(c, x + xx, y + yy, r * 1.1 + 0.15, g * 1.1 + 0.15, b * 1.1 + 0.15);
  }
}

export function drawKeyboard(c, x, y, lit) {
  hline(c, x, y, 7, P.g3, PLANE.TOP);
  hline(c, x, y + 1, 7, P.g1, PLANE.FRONT);
  for (let k = 0; k < 7; k += 2) px(c, x + k, y, P.g5, PLANE.TOP);
  if (lit) for (let k = 1; k < 7; k += 2) gpx(c, x + k, y, P.v3, 0.25);
}

export function drawMug(c, x, y, col) {
  // 3x3 mug + handle, sitting on desk top at (x, y) bottom-left
  rect(c, x, y - 3, 3, 3, col, PLANE.FRONT);
  hline(c, x, y - 3, 3, P.white, PLANE.FRONT);
  px(c, x + 1, y - 3, P.w1, PLANE.FRONT); // coffee
  px(c, x + 3, y - 2, col, PLANE.FRONT);
}

/** desk lamp at right side of seat; on = emissive bulb. returns bulb position */
export function drawLamp(c, x, deskY, on) {
  hline(c, x - 1, deskY - 1, 4, P.g1, PLANE.TOP);
  vline(c, x + 1, deskY - 6, 5, P.g2, PLANE.FRONT);
  px(c, x, deskY - 7, P.g2, PLANE.FRONT);
  // shade
  hline(c, x - 3, deskY - 9, 4, P.a1, PLANE.FRONT);
  hline(c, x - 4, deskY - 8, 5, P.a1, PLANE.FRONT);
  px(c, x - 3, deskY - 10, P.a2, PLANE.FRONT);
  if (on) { gpx(c, x - 3, deskY - 7, P.a4, 1.6); gpx(c, x - 2, deskY - 7, P.a3, 1.2); }
  else { px(c, x - 3, deskY - 7, P.g3, PLANE.FRONT); }
  return { x: x - 2.5, y: deskY - 6.5 };
}

const CHAIR = ['.########.', '#hhhhhhhh#', '#ffffffff#', '#ffffffff#', '#fffffffd#', '#ffffffdd#', '.#ffffdd#.', '..######..'];
/** office chair back. mode: 'sit' (behind a person), 'tucked' (pushed under desk), 'pushed' (rolled away) */
export function drawChairBack(c, x, deskY, col, mode, hi, dk) {
  const top = mode === 'sit' ? deskY - 14 : mode === 'pushed' ? deskY - 11 : deskY - 6;
  const ox = mode === 'pushed' ? 4 : 1;
  for (let r = 0; r < CHAIR.length; r++) for (let q = 0; q < 10; q++) {
    const ch = CHAIR[r][q];
    if (ch === '.') continue;
    px(c, x + ox + q, top + r, ch === '#' ? P.g1 : ch === 'h' ? hi : ch === 'd' ? dk : col, PLANE.FRONT);
  }
  if (mode === 'pushed') {
    vline(c, x + ox + 4, top + 8, deskY - top - 8, P.g2, PLANE.FRONT);
    vline(c, x + ox + 5, top + 8, deskY - top - 8, P.g1, PLANE.FRONT);
  }
}

function hlineG(c, x, y, w, idx) { for (let i = 0; i < w; i++) gpx(c, x + i, y, idx, 0.8, P.ink0); }
