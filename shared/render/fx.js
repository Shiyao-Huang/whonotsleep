// WhoNotSleep renderer — badges & bubbles (overlay layer, drawn crisp after lighting).
// caught "!", question "?", emote bubbles for every EMOTES kind, speech bubbles, name tags.
import { P } from './palette.js';
import { opx, orect, sprite, blit } from './canvas.js';
import { drawText, textWidth, asciiOnly } from './font.js';

export { drawZzz, drawSteam, drawDust, drawCat } from './ambient.js';

const L = {
  '#': 'ink0', x: 'q2', X: 'q1', Q: 'r1', w: 'white', f: 'frost', r: 'r3', R: 'r2', d: 'r1', o: 'r4', v: 'v2', V: 'v1', y: 'y2', Y: 'a4',
  A: 'a1', p: 'p3', P: 'p2', b: 'b3', B: 'b2', a: 'a3', t: 't3', T: 't2', m: 'mist', k: 'ink2', s: 's4', S: 's3',
};

// caught "!": solid red glyph wrapped in an ink line and a white sticker ring -> pops on any background
const BANG_CORE = [
  '.wxX.', 'wxxxX', 'xxxxX', 'xxxXQ', 'xxxXQ', '.xxXQ', '.xXQ.', '.xXQ.', '..Q..', '.....', '.wxX.', '.xXQ.',
];
function ringed(rows) {
  const pad = 2, H = rows.length + pad * 2, W = rows[0].length + pad * 2;
  const g = [];
  for (let y = 0; y < H; y++) { g.push([]); for (let x = 0; x < W; x++) g[y].push(rows[y - pad]?.[x - pad] ?? '.'); }
  const ring = (ch, diag) => {
    const add = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (g[y][x] !== '.') continue;
      let hit = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!diag && dx && dy) continue;
        const v = g[y + dy]?.[x + dx];
        if (v && v !== '.' && v !== ch) hit = true;
      }
      if (hit) add.push([y, x]);
    }
    for (const [y, x] of add) g[y][x] = ch;
  };
  ring('#', true); ring('f', false);
  return g.map((r) => r.join(''));
}
const BANG = ringed(BANG_CORE);
const QBUB = [
  '...#######...', '..#wwwwwww#..', '.#wwwVVVwww#.', '#wwwVvvvVwww#', '#wwVvwwwvVww#', '#wwwwwwVvVww#',
  '#wwwwwVvVwww#', '#wwwwwVvwwww#', '#wwwwwwwwwww#', '#wwwwwVvwwww#', '.#ffffVVfff#.', '..###fff###..',
  '.....#ff#....', '......##.....',
];
const SWEAT = ['..#..', '.#m#.', '.#b#.', '#mbb#', '#wbB#', '#bBB#', '.###.'];

/** keep a bubble of width w inside the visible window (small-layout crop), but only for heads that are in view */
function clampX(c, hx, bx, w) {
  const x0 = c.clipX0 ?? -c.ox, x1 = c.clipX1 ?? c.w - c.ox;
  if (hx < x0 || hx >= x1) return bx;
  return Math.max(x0 + 1, Math.min(x1 - w - 1, bx));
}

/** "!" caught badge: bounces with squash, sweat drops fly off. (x,y) = head-top centre */
export function drawCaught(c, x, y, t) {
  const s = Math.abs(Math.sin(t / 170));
  const bounce = Math.round(s * 4);
  blit(c, sprite(BANG, L), x - 4, Math.max(1 - c.oy, y - 18 - bounce), { over: true });
  // sweat drops arc outward on alternating sides
  const p = (t % 900) / 900;
  const sx = Math.round(p * 4), sy = Math.round(-Math.sin(p * Math.PI) * 3 + p * 4);
  blit(c, sprite(SWEAT, L), x + 6 + sx, y + 1 + sy, { over: true });
  const p2 = ((t + 450) % 900) / 900;
  blit(c, sprite(SWEAT, L), x - 10 - Math.round(p2 * 3), y + 2 + Math.round(-Math.sin(p2 * Math.PI) * 3 + p2 * 4), { over: true });
}

/** big bobbing "?" bubble over a sleeper; clamps inside the frame */
export function drawQuestion(c, x, y, t, phase = 0) {
  const bob = Math.round(Math.sin(t / 420 + phase * 1.9) * 1.5);
  const tilt = Math.floor(t / 1800 + phase) % 4 === 0 ? 1 : 0;
  let bx = x - 6 + tilt, by = y - 15 + bob;
  if (by < 1 - c.oy) { bx = x + 6; by = Math.max(1 - c.oy, y - 9 + bob); } // no headroom: float beside the head
  bx = clampX(c, x, bx, 13);
  blit(c, sprite(QBUB, L), bx, by, { over: true });
}

// 7x7 emote icons (heart, note, zzz, star, wave, angry, moon, question, exclaim, sweat)
const ICONS = {
  heart: ['.rr.rr.', 'roorrrR', 'rorrrrR', 'rrrrrrR', '.rrrRR.', '..rRR..', '...R...'],
  note: ['..VVVVV', '..VvvvV', '..V...V', '..V...V', 'VVV.VVV', 'vvV.vvV', 'VV..VV.'],
  zzz: ['BBBB...', '..B....', '.B.....', 'BBBB...', '....bbb', '.....b.', '....bbb'],
  star: ['...y...', '...Y...', 'yyyYyyy', '.yYYYy.', '..yyy..', '.yy.yy.', '.A...A.'],
  wave: ['.s.s...', '.s.s.s.', '.sssssS', 'ssssss.', 'Ssssss.', '.SsssS.', '..SSS..'],
  angry: ['.rrrrr.', 'rdrrrdr', 'rrdrdrr', 'rrrrrrr', 'rrdddrr', 'rdrrrdr', '.rrrrr.'],
  moon: ['..yyy..', '.yYy...', 'yYy..A.', 'yy.....', 'yYy....', '.yYyyA.', '..yyy..'],
  question: ['.vvvv.', 'vV..Vv', '....Vv', '..vvV.', '..vV..', '......', '..vV..'],
  exclaim: ['.rR.', '.rR.', '.rR.', '.rR.', '.RR.', '....', '.rR.'],
  sweat: ['...b...', '..bbb..', '.bbbbB.', '.bmbbB.', '.bbbbB.', '..BBB..', '.......'],
};
const ICON_SPR = {};
function iconSpr(kind) {
  return ICON_SPR[kind] || (ICON_SPR[kind] = sprite(ICONS[kind] || ICONS.star, L));
}

function bubble(c, x, y, w, h) {
  orect(c, x + 1, y, w - 2, h, P.ink0);
  orect(c, x, y + 1, w, h - 2, P.ink0);
  orect(c, x + 1, y + 1, w - 2, h - 2, P.white);
  for (let k = 2; k < w - 2; k++) opx(c, x + k, y + h - 2, P.frost);
  opx(c, x + 1, y + 1, P.frost); // inner corner softening
}

function tail(c, tx, by) {
  opx(c, tx, by, P.white); opx(c, tx - 1, by, P.ink0); opx(c, tx + 1, by, P.ink0); opx(c, tx, by + 1, P.ink0);
}

/** small rounded bubble containing an emote icon. (x,y) = head-top centre */
export function drawEmote(c, kind, x, y, t, phase = 0) {
  const spr = iconSpr(kind);
  const bw = spr.w + 4, bh = spr.h + 4;
  // wave wiggles, heart pulses, others float
  const wig = kind === 'wave' ? (Math.floor(t / 180) % 2) : 0;
  const pulse = kind === 'heart' && Math.floor(t / 300) % 2 ? 1 : 0;
  let bx = x + 3, by = y - bh - 2 + Math.round(Math.sin(t / 300 + phase) * 0.8) - pulse;
  bx = clampX(c, x, Math.min(c.w - c.ox - bw - 1, bx), bw);
  by = Math.max(1 - c.oy, by);
  bubble(c, bx, by, bw, bh);
  tail(c, bx + 2, by + bh);
  blit(c, spr, bx + 2 + wig, by + 2, { over: true });
}

/** wrap ASCII text into at most 2 lines of maxChars */
function wrap2(s, maxChars) {
  if (s.length <= maxChars) return [s];
  let cut = s.lastIndexOf(' ', maxChars);
  if (cut < maxChars * 0.4) cut = maxChars;
  let a = s.slice(0, cut).trim(), b = s.slice(cut).trim();
  if (b.length > maxChars) b = b.slice(0, maxChars - 1) + '~';
  return b ? [a, b] : [a];
}

/** speech bubble: ASCII text (<=2 lines), otherwise an animated "..." squiggle (app overlays real text) */
export function drawSay(c, text, x, y, t, maxW) {
  const raw = text || '';
  let s = asciiOnly(raw);
  const ascii = s.length > 0 && s.length >= raw.length * 0.6;
  const maxChars = Math.max(3, Math.floor((maxW - 4) / 4));
  const lines = ascii ? wrap2(s, maxChars) : null;
  const tw = lines ? Math.max(...lines.map(textWidth)) : 11;
  const w = tw + 6, h = lines ? 4 + lines.length * 6 : 9;
  const x0 = c.clipX0 ?? -c.ox, x1 = c.clipX1 ?? c.w - c.ox;
  let bx = Math.round(x - w / 2);
  bx = Math.max(x0 + 1, Math.min(x1 - w - 1, bx));
  const by = Math.max(1 - c.oy, y - h - 4);
  bubble(c, bx, by, w, h);
  tail(c, Math.max(bx + 2, Math.min(bx + w - 3, x)), by + h);
  if (lines) lines.forEach((ln, i) => drawText(c, ln, bx + 3 + ((tw - textWidth(ln)) >> 1), by + 2 + i * 6, P.ink1));
  else { // squiggle: three dots that hop in turn
    for (let d = 0; d < 3; d++) {
      const hop = Math.floor(t / 220) % 3 === d ? 1 : 0;
      orect(c, bx + 3 + d * 4, by + 4 - hop, 2, 2, d === 1 ? P.v2 : P.ink3);
    }
  }
}

/** name tag on the desk front: tiny 3x5 text on a dark plate; non-ASCII -> avatar-colour dot */
export function drawNameTag(c, name, cx, y, maxW, dim, col, focus = false) {
  let s = asciiOnly(name).toUpperCase().replace(/\s+/g, '');
  const maxChars = Math.max(1, Math.floor((maxW + 1) / 4));
  const plate = focus ? P.w1 : P.ink0;
  if (!s) {
    orect(c, cx - 3, y - 1, 6, 7, P.ink0); orect(c, cx - 2, y, 4, 5, col); opx(c, cx - 2, y, P.ink0); opx(c, cx + 1, y + 4, P.ink0);
    opx(c, cx - 1, y + 1, P.white);
    return;
  }
  if (s.length > maxChars) s = s.slice(0, maxChars);
  const w = textWidth(s);
  const x = Math.round(cx - w / 2);
  orect(c, x - 2, y - 1, w + 4, 7, plate);
  opx(c, x - 2, y - 1, -1); opx(c, x + w + 1, y - 1, -1); opx(c, x - 2, y + 5, -1); opx(c, x + w + 1, y + 5, -1);
  orect(c, x - 1, y + 5, w + 2, 1, col); // avatar-colour underline
  drawText(c, s, x, y, dim ? P.ink5 : focus ? P.a4 : P.frost);
}
