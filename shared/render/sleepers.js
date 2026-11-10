// WhoNotSleep renderer — sleepers: round head on the pillow, closed eyes, breathing quilt.
import { P } from './palette.js';
import { PLANE, px, rect } from './canvas.js';
import { avatarColors } from './avatar.js';
import { bedY, SLOT_LEN, pillow } from './beds.js';

// 8x8 sleeping head (face up, drawn upright). H hair h shade L light S skin s shade e lid b blush
const HEADS = [
  ['..HHHH..', '.HHLHHH.', 'HHLHHHHh', 'HHSHHSHh', 'HSSSSSSh', 'HSeeSees', '.SbSSbs.', '..SSss..'],  // messy
  ['..HHHH..', '.HHLHHH.', 'HHLHHHHh', 'HHHHHHHh', 'HSSSSSSh', 'HSeeSeeh', 'HSbSSbsh', 'H.SSss.h'],  // long
  ['.H.HH.H.', '.HHLHHH.', 'HHLHHHHh', 'HSHSHSHh', 'HSSSSSSh', 'SSeeSees', '.SbSSbs.', '..SSss..'],  // spiky
  ['..HHHH..', '.HHLHHH.', 'HHLHHHHh', 'HHHHHHHh', 'HSSSSSSh', 'HSeeSeeh', 'HSbSSbsh', '.hSSssh.'],  // bob
  ['...hh...', '..HHHH..', '.HLHHHHh', 'HHSSHHHh', 'HSSSSSSh', 'SSeeSees', '.SbSSbs.', '..SSss..'],  // bun
  ['..hhhh..', '.hHLHHh.', 'hHHHHHHh', 'HSSSSSSh', 'SSSSSSSs', 'SSeeSees', '.SbSSbs.', '..SSss..'],  // buzz
];

function head(c, k, x, y, id) {
  const rows = HEADS[k.style];
  for (let r = 0; r < 8; r++) for (let q = 0; q < 8; q++) {
    const ch = rows[r][q];
    if (ch === '.') continue;
    let col;
    switch (ch) {
      case 'H': col = k.hair; break;
      case 'h': col = k.hairD; break;
      case 'L': col = k.hairL; break;
      case 'S': col = k.skin; break;
      case 's': col = k.skinD; break;
      case 'e': col = k.skinI >= 3 ? P.ink0 : P.ink2; break;
      default: col = k.blush;
    }
    px(c, x + q, y + r, col, PLANE.CHAR, id);
  }
  if (k.style === 1) for (let r = 3; r < 9; r++) { px(c, x - 1, y + r, r > 6 ? k.hairD : k.hair, PLANE.CHAR, id); } // hair fanned on pillow
  if (k.acc === 4) { // cat ears
    px(c, x + 1, y - 1, k.hair, PLANE.CHAR, id); px(c, x + 6, y - 1, k.hair, PLANE.CHAR, id);
    px(c, x + 1, y, P.p3, PLANE.CHAR, id); px(c, x + 6, y, P.p3, PLANE.CHAR, id);
  } else if (k.acc === 2) { // headphones slid down around the neck
    rect(c, x + 1, y + 8, 6, 1, P.g2, PLANE.CHAR, id); px(c, x, y + 7, P.r3, PLANE.CHAR, id); px(c, x + 7, y + 7, P.r3, PLANE.CHAR, id);
  } else if (k.acc === 3) { // cap traded for a floppy nightcap
    rect(c, x + 1, y - 1, 6, 2, k.shirtL, PLANE.CHAR, id);
    for (let q = 0; q < 4; q++) px(c, x + 6 + q, y - 1 + (q >> 1), q & 1 ? k.shirt : k.shirtL, PLANE.CHAR, id);
    px(c, x + 10, y + 1, P.white, PLANE.CHAR, id);
    for (let q = 1; q < 7; q++) px(c, x + q, y + 1, P.white, PLANE.CHAR, id);
  }
}

/** sleeper: pillow + head + quilt in shirt colour that rises & falls with breath */
export function drawSleeper(c, slot, av, { t = 0, id = 0, n = 0 } = {}) {
  const k = avatarColors(av);
  const by = bedY(slot), x = slot.x;
  const CH = PLANE.CHAR;
  pillow(c, x, by);
  head(c, k, x - 1, by - 9, id);
  if (k.acc === 1) { // glasses folded on the pillow corner
    px(c, x + 5, by - 3, P.g1, PLANE.FRONT); px(c, x + 6, by - 3, P.mist, PLANE.FRONT); px(c, x + 4, by - 3, P.mist, PLANE.FRONT);
  }
  const breath = Math.sin(t / 1100 + n * 1.7);
  const x0 = x + 6, len = slot.kind === 'bed' ? 22 : SLOT_LEN - 6;
  for (let xx = 0; xx < len; xx++) {
    const u = xx / len;
    const chest = u < 0.45 ? 0.5 + breath * 0.7 : 0;
    const rise = Math.round(Math.sin(u * Math.PI * 0.9 + 0.2) * 2 + chest);
    const top = by - 2 - rise;
    for (let yy = top; yy <= by + 1; yy++) {
      const d = yy - top;
      let col = k.shirt;
      if (d === 0) col = k.shirtL;
      else if ((xx + 2) % 6 === 0 || d === 3) col = k.shirtD;                 // stitched patches
      else if (((xx / 6 | 0) + (d > 3 ? 1 : 0)) & 1 && ((xx + yy) & 1)) col = k.shirtL; // checker patch
      if (yy === by + 1) col = k.shirtDD;
      px(c, x0 + xx, yy, col, d === 0 ? PLANE.TOP : CH, id);
    }
  }
  // turned-down hem at the chin + a hand resting on top
  for (let yy = by - 4; yy <= by + 1; yy++) { px(c, x0, yy, P.white, CH, id); px(c, x0 + 1, yy, yy === by - 4 ? P.white : P.frost, CH, id); }
  px(c, x0 + 2, by - 4 - (breath > 0.4 ? 1 : 0), k.skin, CH, id); px(c, x0 + 3, by - 4 - (breath > 0.4 ? 1 : 0), k.skinD, CH, id);
}
