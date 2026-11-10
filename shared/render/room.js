// WhoNotSleep renderer — layout plans + room shell (wall, floor, window, decor).
import { P } from './palette.js';
import { PLANE, rect, px, hline, vline, dither, gpx, shade, blobShadow, hash2, sprite, blit } from './canvas.js';
import { drawSky } from './sky.js';
import { drawText } from './font.js';

/**
 * Build a layout plan: geometry for every element.
 * nDesks: number of desk seats to draw; nBeds: number of bed slots.
 */
export function makePlan(layout, nDesks, nBeds) {
  if (layout === 'small') {
    return {
      W: 96, H: 96, floorY: 58, wainY: 46, deskY: 74, deskX0: 40, deskX1: 94,
      win: { x: 8, y: 7, w: 30, h: 28 }, clock: { x: 78, y: 6 }, shelf: { x: 50, y: 24, w: 26 },
      posters: [{ x: 82, y: 22, kind: 2 }], fairy: [44, 2, 94],
      seats: seatRow(1, 52, 92, true), bunk: null,
      beds: [{ x: 5, y: 70, kind: 'bed' }], bedArea: { x: 1, y: 62, w: 36 },
      rug: { x: 6, y: 86, w: 84, h: 9 },
      catY: 92, hang: [40, 9], clutter: null,
    };
  }
  const wide = layout === 'wide';
  const o = wide ? -22 : 0;
  const p = {
    W: 192, H: wide ? 88 : 120,
    floorY: 74 + o, wainY: 60 + o, deskY: 88 + o, deskX0: 58, deskX1: 190,
    win: wide ? { x: 92, y: 4, w: 46, h: 26 } : { x: 90, y: 8, w: 48, h: 34 },
    clock: wide ? { x: 154, y: 6 } : { x: 158, y: 9 },
    shelf: wide ? { x: 148, y: 24, w: 38 } : { x: 148, y: 34, w: 38 },
    posters: wide ? [{ x: 62, y: 8, kind: 0 }, { x: 77, y: 12, kind: 1 }] : [{ x: 62, y: 12, kind: 0 }, { x: 76, y: 20, kind: 1 }, { x: 174, y: 9, kind: 3 }],
    fairy: [56, 2, 190],
    bunk: wide ? { x: 2, top: 4, upper: 22, lower: 46, foot: 66 } : { x: 2, top: 24, upper: 42, lower: 72, foot: 96 },
    rug: wide ? null : { x: 72, y: 106, w: 112, h: 12 },
    catY: wide ? 84 : 112,
    hang: wide ? [143, 5] : [147, 12],
    clutter: wide ? null : [6, 114],
  };
  const n = Math.max(nDesks, 3);
  p.seats = seatRow(n, p.deskX0, p.deskX1, false);
  const b = p.bunk;
  const bx = b.x + 2;
  p.beds = [
    { x: bx, y: b.lower, kind: 'bunk' }, { x: bx + 25, y: b.lower, kind: 'bunk' },
    { x: bx, y: b.upper, kind: 'bunk' }, { x: bx + 25, y: b.upper, kind: 'bunk' },
    wide ? { x: 3, y: 77, kind: 'futon' } : { x: 3, y: 104, kind: 'futon' },
    wide ? { x: 27, y: 77, kind: 'futon' } : { x: 27, y: 104, kind: 'futon' },
  ];
  return p;
}

function seatRow(n, x0, x1, single) {
  const sw = single ? x1 - x0 : Math.min(34, Math.floor((x1 - x0) / n));
  const start = single ? x0 : x0 + Math.floor((x1 - x0 - sw * n) / 2);
  const seats = [];
  for (let i = 0; i < n; i++) {
    const x = start + i * sw;
    const big = sw >= 26;
    const mw = big ? 13 : sw >= 24 ? 11 : 9;          // monitor width (narrow seats: compact 9px monitor)
    seats.push({ x, w: sw, monX: x + 1, monW: mw, monH: big ? 10 : sw >= 24 ? 9 : 8, charX: x + mw + Math.max(1, ((sw - mw - 12) >> 1)) });
  }
  return seats;
}

// ------------------------------------------------------------------ shell
export function drawShell(c, plan, tod, t, seed) {
  const { W, H, floorY, wainY } = plan;
  // wallpaper: dusty indigo with a faint vertical stripe + tiny star motif
  rect(c, 0, 0, W, floorY, P.ink5, PLANE.WALL);
  for (let x = 0; x < W; x += 8) vline(c, x + 3, 0, wainY, P.ink4, PLANE.WALL);
  for (let y = 6; y < wainY - 4; y += 10) for (let x = (y % 20 === 6 ? 0 : 4); x < W; x += 8) px(c, x + 1, y, P.ink6, PLANE.WALL);
  hline(c, 0, 0, W, P.ink3, PLANE.WALL);
  hline(c, 0, 1, W, P.ink4, PLANE.WALL);
  // wainscot panels
  rect(c, 0, wainY, W, floorY - wainY, P.w3, PLANE.WALL);
  hline(c, 0, wainY, W, P.w5, PLANE.WALL);
  hline(c, 0, wainY + 1, W, P.w4, PLANE.WALL);
  for (let x = 4; x < W; x += 12) {
    rect(c, x, wainY + 4, 9, floorY - wainY - 7, P.w2, PLANE.WALL);
    rect(c, x + 1, wainY + 5, 7, floorY - wainY - 9, P.w3, PLANE.WALL);
    hline(c, x + 1, floorY - 4, 8, P.w4, PLANE.WALL);
  }
  rect(c, 0, floorY - 2, W, 2, P.w1, PLANE.WALL);
  // floor boards
  rect(c, 0, floorY, W, H - floorY, P.w4, PLANE.FLOOR);
  let row = 0;
  for (let y = floorY; y < H; row++) {
    const bh = 3 + Math.min(3, row >> 1);
    hline(c, 0, y, W, P.w3, PLANE.FLOOR);
    const off = (hash2(row, 3, 9) * 30) | 0;
    for (let x = -off; x < W; x += 26 + ((hash2(row, x, 2) * 14) | 0)) vline(c, x, y, bh, P.w3, PLANE.FLOOR);
    for (let x = 0; x < W; x++) if (hash2(x, row, 77) > 0.93) px(c, x, y + 1 + ((hash2(x, row) * (bh - 1)) | 0), P.w5, PLANE.FLOOR);
    y += bh;
  }
  shade(c, 0, floorY, W, 2, 0.55);
  shade(c, 0, floorY + 2, W, 2, 0.8);
  shade(c, 0, 0, W, 3, 0.7);
  drawWindow(c, plan.win, tod, t, seed, floorY);
  for (const p of plan.posters) drawPoster(c, p.x, p.y, p.kind);
  drawShelf(c, plan.shelf);
  drawClock(c, plan.clock.x, plan.clock.y, tod.hour);
  if (plan.rug) drawRug(c, plan.rug);
}

function drawWindow(c, win, tod, t, seed, floorY) {
  const { x, y, w, h } = win;
  drawSky(c, x, y, w, h, tod, t, seed);
  // frame
  rect(c, x - 2, y - 2, w + 4, 2, P.w5, PLANE.FRONT);
  rect(c, x - 2, y + h, w + 4, 1, P.w4, PLANE.FRONT);
  rect(c, x - 2, y, 2, h, P.w4, PLANE.FRONT);
  rect(c, x + w, y, 2, h, P.w3, PLANE.FRONT);
  vline(c, x + (w >> 1), y, h, P.w4, PLANE.FRONT);
  hline(c, x, y + Math.round(h * 0.45), w, P.w4, PLANE.FRONT);
  // sill
  rect(c, x - 4, y + h + 1, w + 8, 2, P.w5, PLANE.TOP);
  rect(c, x - 3, y + h + 3, w + 6, 1, P.w2, PLANE.FRONT);
  shade(c, x - 3, y + h + 4, w + 6, 2, 0.6);
  // little succulent + candle on the sill
  rect(c, x + 3, y + h - 2, 4, 3, P.r2, PLANE.FRONT); hline(c, x + 3, y + h - 2, 4, P.r3, PLANE.FRONT);
  px(c, x + 4, y + h - 4, P.e3, PLANE.FRONT); px(c, x + 5, y + h - 5, P.e4, PLANE.FRONT); px(c, x + 6, y + h - 4, P.e3, PLANE.FRONT);
  px(c, x + 3, y + h - 3, P.e2, PLANE.FRONT); px(c, x + 5, y + h - 3, P.e3, PLANE.FRONT); px(c, x + 6, y + h - 3, P.e2, PLANE.FRONT);
  // curtains
  drawCurtain(c, x - 7, y - 3, h + 6, false);
  drawCurtain(c, x + w + 1, y - 3, h + 6, true);
  // rod
  hline(c, x - 9, y - 4, w + 18, P.g2, PLANE.FRONT);
  px(c, x - 10, y - 4, P.a2, PLANE.FRONT); px(c, x + w + 9, y - 4, P.a2, PLANE.FRONT);
}

function drawCurtain(c, x, y, h, right) {
  for (let yy = 0; yy < h; yy++) {
    const sway = Math.round(Math.sin(yy / 6) * 0.6);
    const tie = yy > h * 0.55 && yy < h * 0.62;
    const wdt = tie ? 4 : yy > h * 0.6 ? 5 + Math.min(2, (yy - h * 0.6) / 4) : 6;
    for (let k = 0; k < wdt; k++) {
      const xx = right ? x + k + sway + (6 - wdt) : x + k + sway;
      const fold = (k + (right ? 1 : 0)) % 3;
      px(c, xx, y + yy, tie ? P.a2 : fold === 0 ? P.v1 : fold === 1 ? P.v2 : P.v3 , PLANE.FRONT);
    }
  }
}

const POSTERS = [
  // 0: big moon over waves
  { rows: ['############', '#vvvvvvvvvv#', '#vv**vvvvvv#', '#v*aa*vvvsv#', '#v*aaa*vvvv#', '#vv*aa*vvvv#', '#vvv**vvsvv#', '#vvvvvvvvvv#', '#vvsvvvvvvv#', '#tttttttttt#', '#TtTTtTTtTT#', '#TTTTTTTTTT#', '#vvvvvvvvvv#', '#vRRRRvvvvv#', '############'],
    legend: { '#': 'w1', v: 'v1', '*': 'a3', a: 'a4', s: 'mist', t: 't2', T: 't1', R: 'p3' } },
  // 1: pixel invader card
  { rows: ['#########', '#ggggggg#', '#gm...mg#', '#g.mmm.g#', '#gm.m.mg#', '#gmmmmmg#', '#g.m.m.g#', '#ggggggg#', '#ggrrrgg#', '#########'],
    legend: { '#': 'g1', g: 'ink2', m: 't4', '.': 'ink2', r: 'r3' } },
  // 2: cat poster (small)
  { rows: ['#######', '#ppppp#', '#k.p.k#', '#kkkkk#', '#kwkwk#', '#pkkkp#', '#######'],
    legend: { '#': 'w1', p: 'p2', k: 'ink1', '.': 'p2', w: 'y2' } },
  // 3: sticky notes cork board
  { rows: ['##########', '#cccccccc#', '#cyycppcc#', '#cyycppcc#', '#cccccttc#', '#cbbccttc#', '#cbbccccc#', '##########'],
    legend: { '#': 'w2', c: 'w4', y: 'y2', p: 'p3', t: 't4', b: 'b4' } },
];

function drawPoster(c, x, y, kind) {
  const d = POSTERS[kind];
  const spr = sprite(d.rows, d.legend);
  blit(c, spr, x, y, { plane: PLANE.FRONT });
  shade(c, x + 1, y + spr.h, spr.w, 1, 0.65);
  shade(c, x + spr.w, y + 1, 1, spr.h, 0.65);
  px(c, x + (spr.w >> 1), y, P.r3, PLANE.FRONT); // pin
}

const PLANT = ['..e.E..', '.eEeE..', 'EeEeEe.', '.eEEe..', '..EEe..', '.rrrrr.', '.RRRRR.', '..RRR..'];
const PLANT_L = { e: 'e3', E: 'e4', r: 'r3', R: 'r2' };

function drawShelf(c, s) {
  const { x, y, w } = s;
  // books
  const cols = [P.r2, P.t2, P.y2, P.v2, P.b2, P.p2, P.w4, P.t3];
  let bx = x + 10;
  for (let i = 0; i < 7 && bx < x + w - 2; i++) {
    const bh = 5 + ((hash2(i, 5) * 3) | 0), bw = 2 + (i % 3 === 0 ? 1 : 0);
    const col = cols[i % cols.length];
    if (i === 5) { // leaning book
      for (let k = 0; k < bh; k++) { px(c, bx + (k >> 1), y - 1 - k, col, PLANE.FRONT); px(c, bx + 1 + (k >> 1), y - 1 - k, col, PLANE.FRONT); }
      bx += 4; continue;
    }
    rect(c, bx, y - bh, bw, bh, col, PLANE.FRONT);
    hline(c, bx, y - bh + 1, bw, P.a4, PLANE.FRONT);
    bx += bw;
  }
  // plant pot with trailing leaves
  blit(c, sprite(PLANT, PLANT_L), x + 1, y - 8, { plane: PLANE.FRONT });
  for (let k = 0; k < 9; k++) px(c, x + 2 + (k % 2), y + 1 + k, k % 3 === 0 ? P.e4 : P.e3, PLANE.FRONT);
  for (let k = 0; k < 5; k++) px(c, x + 6 - (k % 2), y + 1 + k, P.e3, PLANE.FRONT);
  // plank + brackets
  hline(c, x, y, w, P.w5, PLANE.TOP);
  hline(c, x, y + 1, w, P.w3, PLANE.FRONT);
  px(c, x + 5, y + 2, P.w2, PLANE.FRONT); px(c, x + w - 6, y + 2, P.w2, PLANE.FRONT);
  shade(c, x, y + 2, w, 2, 0.6);
}

function drawClock(c, x, y, hour) {
  const R = ['..###..', '.#####.', '#######', '#######', '#######', '.#####.', '..###..'];
  for (let yy = 0; yy < 7; yy++) for (let xx = 0; xx < 7; xx++) if (R[yy][xx] === '#') px(c, x + xx, y + yy, P.w1, PLANE.FRONT);
  for (let yy = 1; yy < 6; yy++) for (let xx = 1; xx < 6; xx++) if ((xx - 3) ** 2 + (yy - 3) ** 2 <= 5) px(c, x + xx, y + yy, P.white, PLANE.FRONT);
  // ticks
  px(c, x + 3, y + 1, P.g4, PLANE.FRONT); px(c, x + 5, y + 3, P.g4, PLANE.FRONT); px(c, x + 3, y + 5, P.g4, PLANE.FRONT); px(c, x + 1, y + 3, P.g4, PLANE.FRONT);
  const hA = ((hour % 12) / 12) * Math.PI * 2, mA = ((hour * 60) % 60) / 60 * Math.PI * 2;
  px(c, x + 3 + Math.round(Math.sin(mA) * 2), y + 3 - Math.round(Math.cos(mA) * 2), P.g3, PLANE.FRONT);
  px(c, x + 3 + Math.round(Math.sin(hA) * 1.4), y + 3 - Math.round(Math.cos(hA) * 1.4), P.r2, PLANE.FRONT);
  px(c, x + 3, y + 3, P.ink1, PLANE.FRONT);
  shade(c, x + 1, y + 7, 6, 1, 0.65);
}

function drawRug(c, r) {
  const { x, y, w, h } = r;
  for (let yy = 0; yy < h; yy++) {
    const inset = yy === 0 || yy === h - 1 ? 2 : yy === 1 || yy === h - 2 ? 1 : 0;
    for (let xx = inset; xx < w - inset; xx++) {
      const border = yy <= 1 || yy >= h - 2 || xx <= 1 + inset || xx >= w - 2 - inset;
      const diamond = (Math.abs(((xx + 3) % 8) - 4) + Math.abs(yy - (h >> 1))) === 3;
      px(c, x + xx, y + yy, border ? P.r1 : diamond ? P.a2 : (xx + yy) % 2 && yy % 3 === 0 ? P.r1 : P.r2, PLANE.FLOOR);
    }
  }
  shade(c, x + 2, y + h, w - 4, 1, 0.7);
}

/** fairy lights strung along the top of the wall (emissive bulbs) */
export function drawFairyLights(c, f, t) {
  const [x0, y0, x1] = f;
  const cols = [P.a3, P.p3, P.t4, P.v4, P.a4];
  const span = 22;
  for (let x = x0; x <= x1; x++) {
    const u = ((x - x0) % span) / span;
    const sag = Math.round(Math.sin(u * Math.PI) * 4);
    px(c, x, y0 + sag, P.g1, PLANE.FRONT);
    if ((x - x0) % 5 === 2) {
      const n = ((x - x0) / 5) | 0;
      const tw = 0.75 + 0.35 * Math.sin(t / 700 + n * 2.1);
      gpx(c, x, y0 + sag + 1, cols[n % cols.length], 1.1 * tw);
    }
  }
}

export { drawText };

const HPLANT = ['..rRr..', '.rRRRr.', '..rrr..'];
/** macrame hanging plant from the ceiling with trailing leaves (sways gently) */
export function drawHangingPlant(c, x, len, t) {
  const sw = Math.sin(t / 1800) * 0.8;
  for (let y = 0; y < len; y++) {
    const o = Math.round(sw * y / len);
    px(c, x + 3 + o - (y > len - 4 ? 1 : 0), y, P.w5, PLANE.FRONT);
    if (y > len - 4) px(c, x + 3 + o + 1, y, P.w5, PLANE.FRONT);
  }
  const o = Math.round(sw);
  const pot = sprite(HPLANT, { r: 'w5', R: 'w4' });
  blit(c, pot, x + o, len, { plane: PLANE.FRONT });
  // leaves on top + trailing vines
  const leaves = [[1, -1], [2, -2], [4, -2], [5, -1], [3, -3], [0, 0], [6, 0]];
  for (const [lx, ly] of leaves) px(c, x + o + lx, len + ly, (lx + ly) % 2 ? P.e4 : P.e3, PLANE.FRONT);
  for (let v = 0; v < 3; v++) {
    const vx = x + o + [0, 3, 6][v], vl = [7, 10, 5][v];
    for (let k = 1; k < vl; k++) {
      const wob = Math.round(Math.sin(k * 0.9 + v + t / 2200) * 0.6);
      px(c, vx + wob, len + 2 + k, k % 3 === 0 ? P.e4 : k % 3 === 1 ? P.e3 : P.e2, PLANE.FRONT);
    }
  }
}

/** books, a game controller and slippers on the floor */
export function drawFloorClutter(c, x, y) {
  const cols = [P.b2, P.r2, P.y2, P.t2];
  for (let k = 0; k < 4; k++) {
    const w = 9 - (k & 1), off = k === 2 ? 1 : 0;
    rect(c, x + off, y - 2 * k - 2, w, 2, cols[k], PLANE.FRONT);
    hline(c, x + off, y - 2 * k - 2, w, P.white, PLANE.TOP);
    px(c, x + off + w - 1, y - 2 * k - 1, P.white, PLANE.FRONT);
  }
  blobShadow(c, x + 5, y, 7, 1, 0.5);
  // controller
  rect(c, x + 13, y - 2, 6, 2, P.g2, PLANE.FRONT); px(c, x + 12, y - 1, P.g2, PLANE.FRONT); px(c, x + 19, y - 1, P.g2, PLANE.FRONT);
  px(c, x + 14, y - 2, P.g4, PLANE.TOP); px(c, x + 17, y - 2, P.r3, PLANE.TOP); px(c, x + 18, y - 2, P.t3, PLANE.TOP);
  blobShadow(c, x + 16, y, 5, 1, 0.55);
  // slippers
  for (const sx of [x + 24, x + 29]) { rect(c, sx, y - 1, 4, 2, P.p2, PLANE.FRONT); hline(c, sx + 1, y - 2, 2, P.p3, PLANE.TOP); px(c, sx, y - 1, P.white, PLANE.FRONT); }
  blobShadow(c, x + 29, y + 1, 6, 1, 0.6);
}
