// WhoNotSleep renderer — 12x18 seated desk chibi (front view) with poses + expressions.
// Box: (x, y) = top-left; head rows 0..10, torso 11..17; desk top sits at y+16.
import { P } from './palette.js';
import { PLANE, px, rect } from './canvas.js';
import { avatarColors, avatarPalette, ACCESSORIES, DARK, LIGHT } from './avatar.js';
import { HAIRS, FACE, TORSO, CAP } from './hair.js';

export { avatarColors, avatarPalette, ACCESSORIES, DARK, LIGHT };
const C = PLANE.CHAR;

function layer(c, rows, x, y, k, id, skipAbove = -99) {
  for (let r = 0; r < rows.length; r++) {
    if (y + r < skipAbove) continue;
    const row = rows[r];
    for (let q = 0; q < row.length; q++) {
      const ch = row.charCodeAt(q);
      if (ch === 46) continue; // '.'
      px(c, x + q, y + r, ch === 104 ? k.hairD : ch === 76 ? k.hairL : k.hair, C, id); // h / L / H
    }
  }
}

/** eyes: kind 'open' | 'blink' | 'shock' | 'calm'. look shifts pupils (-1 toward a left monitor). */
function eyes(c, k, x, y, kind, look) {
  for (const ex of [3, 7]) {
    const X = x + ex;
    if (kind === 'blink' || kind === 'calm') {
      px(c, X, y + 6, k.eye, C); px(c, X + 1, y + 6, k.eye, C);
      if (kind === 'calm') { px(c, X + (ex === 3 ? -1 : 2), y + 5, k.skinD, C); }
    } else if (kind === 'shock') {
      px(c, X, y + 5, P.white, C); px(c, X + 1, y + 5, P.white, C);
      px(c, X, y + 6, P.white, C); px(c, X + 1, y + 6, k.eye, C);
      px(c, X, y + 4, k.skinD, C); px(c, X + 1, y + 4, k.skinD, C);
    } else {
      const s = look < 0 ? -1 : look > 0 ? 1 : 0;
      const L = X + (s < 0 && ex === 7 ? -1 : 0) + (s > 0 && ex === 3 ? 1 : 0);
      px(c, L, y + 5, P.white, C); px(c, L + 1, y + 5, k.eye, C);
      px(c, L, y + 6, k.eye, C); px(c, L + 1, y + 6, k.eye, C);
      // soft lower lid (lighter iris) gives a sparkle on dark skins too
      if (k.skinI >= 3) { px(c, L + 1, y + 6, P.ink4, C); px(c, L, y + 4, k.skinDD, C); }
    }
  }
}

function mouth(c, k, x, y, kind) {
  const m = k.skinI >= 4 ? P.r1 : k.skinI >= 2 ? P.r1 : P.r2;
  if (kind === 'smile') { px(c, x + 5, y + 8, m, C); px(c, x + 6, y + 8, m, C); px(c, x + 4, y + 7, k.skinD, C); px(c, x + 7, y + 7, k.skinD, C); }
  else if (kind === 'o') { px(c, x + 5, y + 8, P.r0, C); px(c, x + 6, y + 8, P.r1, C); px(c, x + 5, y + 9, P.r1, C); px(c, x + 6, y + 9, P.r0, C); }
  else if (kind === 'sip') { px(c, x + 6, y + 8, P.r0, C); }
  else if (kind === 'cat') { px(c, x + 5, y + 8, m, C); px(c, x + 6, y + 9, m, C); px(c, x + 7, y + 8, m, C); }
  else px(c, x + 6, y + 8, k.skinDD, C);
}

function accessoryBack(c, k, x, y, id) {
  if (k.acc === 2) { // headphone cups sit outside the head
    for (const ex of [-1, 11]) {
      rect(c, x + ex, y + 4, 2, 4, P.g2, C, id);
      px(c, x + ex + (ex < 0 ? 0 : 1), y + 5, P.r3, C, id);
      px(c, x + ex + (ex < 0 ? 0 : 1), y + 6, P.r2, C, id);
      px(c, x + ex + (ex < 0 ? 1 : 0), y + 7, P.g1, C, id);
    }
  }
}

function accessoryFront(c, k, x, y, id) {
  if (k.acc === 1) { // glasses: strong brow bar, light lower rim, lens glint
    const fr = k.skinI >= 4 ? P.g4 : P.g1, lo = k.skinI >= 4 ? P.g5 : P.g3;
    for (const ex of [2, 7]) {
      for (let q = 0; q < 4; q++) px(c, x + ex - (ex === 7 ? 1 : 0) + q, y + 4, fr, C, id);
      px(c, x + ex - (ex === 7 ? 1 : 0) + 1, y + 7, lo, C, id); px(c, x + ex - (ex === 7 ? 1 : 0) + 2, y + 7, lo, C, id);
    }
    px(c, x + 1, y + 5, fr, C, id); px(c, x + 10, y + 5, fr, C, id);
    px(c, x + 5, y + 5, P.mist, C, id); px(c, x + 9, y + 5, P.frost, C, id);
  } else if (k.acc === 2) { // band over the head
    for (let q = 2; q <= 9; q++) px(c, x + q, y - 3, q === 4 ? P.g4 : P.g2, C, id);
    px(c, x + 1, y - 2, P.g2, C, id); px(c, x + 10, y - 2, P.g2, C, id);
    for (let r = -1; r <= 3; r++) { px(c, x, y + r, P.g1, C, id); px(c, x + 11, y + r, P.g1, C, id); }
  } else if (k.acc === 3) { // cap in shirt colour
    const rows = CAP.rows;
    for (let r = 0; r < rows.length; r++) for (let q = 0; q < 12; q++) {
      const ch = rows[r][q];
      if (ch === '.') continue;
      const col = ch === 'C' ? k.shirt : ch === 'c' ? k.shirtD : ch === 'L' ? k.shirtL : k.shirtDD;
      px(c, x + q, y + CAP.y + r, col, C, id);
    }
    for (let q = 1; q < 10; q++) px(c, x + q, y + CAP.y + rows.length, k.skinD, C, id); // brim shadow
  } else if (k.acc === 4) { // cat ears
    for (const ex of [1, 8]) {
      px(c, x + ex + (ex === 1 ? 0 : 2), y - 4, k.hair, C, id);
      px(c, x + ex, y - 3, k.hair, C, id); px(c, x + ex + 1, y - 3, ex === 1 ? P.p3 : k.hair, C, id); px(c, x + ex + 2, y - 3, ex === 1 ? k.hair : P.p3, C, id);
      for (let q = 0; q < 3; q++) px(c, x + ex + q, y - 2, q === 1 ? P.p2 : k.hairD, C, id);
    }
  }
}

function torso(c, k, x, y, id) {
  const by = y + 11;
  for (let r = 0; r < TORSO.length; r++) for (let q = 0; q < 12; q++) {
    const ch = TORSO[r][q];
    if (ch === '.') continue;
    let col = k.shirt;
    if (ch === 't') col = k.shirtD;
    else if (ch === 'D') col = k.shirtDD;
    else if (ch === 'c') col = k.hoodie ? k.shirtD : r === 0 ? k.skinD : k.skin;
    px(c, x + q, by + r, col, C, id);
  }
  // shoulder highlights
  px(c, x + 3, by, k.shirtL, C, id); px(c, x + 2, by + 1, k.shirtL, C, id);
  if (k.hoodie) { // hood rim + drawstrings
    px(c, x + 3, by - 1, k.shirtD, C, id); px(c, x + 8, by - 1, k.shirtD, C, id);
    px(c, x + 4, by + 2, P.frost, C, id); px(c, x + 7, by + 2, P.frost, C, id);
    px(c, x + 4, by + 3, P.mist, C, id);
    rect(c, x + 3, by + 4, 6, 1, k.shirtD, C, id); // pouch seam
  } else {
    px(c, x + 4, by, k.shirtL, C, id); px(c, x + 7, by, k.shirtL, C, id); // collar rim
  }
}

/**
 * Draw a seated chibi. opts: pose 'typing'|'sitting', t, id (object id for outline/rim),
 * seedN (phase), look (-1 toward monitor), mood 'normal'|'caught'.
 * Returns { mug: {x,y} | null, hy } — mug top (for steam) and the head top row actually used.
 */
export function drawCharacter(c, av, x, y, opts = {}) {
  const { pose = 'typing', t = 0, id = 0, seedN = 0, look = 0, mood = 'normal' } = opts;
  const k = avatarColors(av);
  const caught = mood === 'caught';
  const hs = HAIRS[k.style];
  let hx = x, hy = y, eye = 'open', mo = 'flat', mug = null, armsUp = false, sip = false;
  const blink = Math.floor(t / 120 + seedN * 17) % 31 === 0;
  if (pose === 'typing') {
    hy += Math.floor(t / 520 + seedN) % 2;                       // head bob with the rhythm
    if (caught) { eye = 'shock'; mo = 'o'; if (Math.floor(t / 140) % 6 === 0) hx += 1; }
    else if (blink) eye = 'blink';
  } else if (pose === 'sitting') {
    // 9s loop: lean back w/ hands behind head (0-5s) -> mug at chest, sip around 6.5-7.6s
    const ph = ((t + seedN * 2300) % 9000) / 9000;
    if (ph < 0.56) {
      armsUp = true; hx += 1; hy += 1; eye = ph > 0.12 && ph < 0.4 ? 'calm' : blink ? 'blink' : 'open'; mo = 'smile';
    } else {
      sip = ph > 0.72 && ph < 0.84;
      eye = sip ? 'calm' : blink ? 'blink' : 'open'; mo = sip ? 'sip' : 'cat';
    }
  }
  const by = y + 11;
  // ---- behind the head: long hair, elbows (lean back), headphone cups
  if (hs.back) layer(c, hs.back.rows, hx, hy + hs.back.y, k, id);
  if (armsUp) { // hands laced behind the head: pointed elbows out, upper arms down to the shoulders
    for (const m of [-1, 1]) {
      const X = (q) => (m < 0 ? hx + q : hx + 11 - q);
      px(c, X(-1), hy + 2, k.shirtL, C, id);
      px(c, X(-2), hy + 3, k.shirt, C, id); px(c, X(-1), hy + 3, k.shirtL, C, id);
      px(c, X(-2), hy + 4, k.shirtD, C, id); px(c, X(-1), hy + 4, k.shirt, C, id); px(c, X(0), hy + 4, k.shirt, C, id);
      for (let r = 5; r < 11; r++) px(c, X(0), hy + r, r === 5 ? k.shirt : k.shirtD, C, id);
      px(c, X(1), hy + 2, k.skin, C, id); // knuckles peeking above the hair line
    }
  }
  accessoryBack(c, k, hx, hy, id);
  // ---- torso (doesn't bob; leaning back sinks it 1px)
  torso(c, k, x, y + (armsUp ? 1 : 0), id);
  // ---- face
  for (let r = 0; r < FACE.length; r++) for (let q = 0; q < 12; q++) {
    const ch = FACE[r][q];
    if (ch === '.') continue;
    const col = ch === 'S' ? k.skin : ch === 's' ? k.skinD : k.skinDD;
    px(c, hx + q, hy + r, col, C, id);
  }
  px(c, hx + 2, hy + 2, k.skinL, C, id); px(c, hx + 3, hy + 1, k.skinL, C, id); // forehead sheen
  eyes(c, k, hx, hy, eye, pose === 'typing' ? look : 0);
  if (!caught) { px(c, hx + 2, hy + 7, k.blush, C, id); px(c, hx + 9, hy + 7, k.blush, C, id); }
  else for (const q of [6, 8]) { px(c, hx + q, hy + 1, P.b2, C, id); px(c, hx + q, hy + 2, P.b2, C, id); px(c, hx + q, hy + 3, P.b1, C, id); }
  mouth(c, k, hx, hy, mo);
  // ---- hair front (cap hides the crown)
  layer(c, hs.front, hx, hy + hs.dy, k, id, k.acc === 3 ? hy + 2 : -99);
  if (hs.drape) layer(c, hs.drape.rows, hx, hy + hs.drape.y, k, id);
  accessoryFront(c, k, hx, hy, id);
  // ---- arms / hands
  if (pose === 'typing') {
    const f = caught ? 1 : Math.floor(t / 130 + seedN) % 3;       // 3-frame typing loop
    px(c, x + 2, by + 2, k.shirtD, C, id); px(c, x + 9, by + 2, k.shirtD, C, id);
    px(c, x + 3, by + 3, k.shirtD, C, id); px(c, x + 8, by + 3, k.shirtD, C, id);
    px(c, x + 2, by + 4 - (f === 0 ? 1 : 0), k.skin, C, id); px(c, x + 3, by + 4, k.skin, C, id);
    px(c, x + 8, by + 4, k.skin, C, id); px(c, x + 9, by + 4 - (f === 2 ? 1 : 0), k.skin, C, id);
    if (caught) { px(c, x + 2, by + 3, k.skin, C, id); px(c, x + 9, by + 3, k.skin, C, id); }
  } else if (pose === 'sitting' && !armsUp) {
    // both hands around a mug; it rises to the mouth while sipping
    const my = sip ? hy + 8 : by + 2;
    rect(c, x + 4, my, 4, 3, P.white, C, id);
    px(c, x + 4, my, P.frost, C, id); px(c, x + 8, my + 1, P.white, C, id); px(c, x + 7, my + 2, P.frost, C, id);
    px(c, x + 5, my, P.w1, C, id); px(c, x + 6, my, P.w2, C, id);                 // cocoa
    px(c, x + 5, my + 1, k.shirtL, C, id); px(c, x + 6, my + 1, k.shirt, C, id);  // mug motif
    px(c, x + 3, my + 1, k.skin, C, id); px(c, x + 3, my + 2, k.skinD, C, id); px(c, x + 8, my + 2, k.skin, C, id);
    if (sip) { px(c, x + 3, by + 1, k.shirtD, C, id); px(c, x + 8, by + 1, k.shirtD, C, id); }
    mug = { x: x + 5.5, y: my - 1 };
  }
  return { mug, hy };
}
