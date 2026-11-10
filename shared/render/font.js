// WhoNotSleep renderer — tiny 3x5 ASCII pixel font.
// Each glyph = 5 rows, each row a digit 0-7 whose bits are the 3 columns (4=left,1=right).
import { opx, px, gpx } from './canvas.js';

const G = {
  A: '25755', B: '65656', C: '34443', D: '65556', E: '74647', F: '74644', G: '34553',
  H: '55755', I: '72227', J: '11153', K: '55655', L: '44447', M: '57755', N: '65555',
  O: '25552', P: '65644', Q: '25563', R: '65655', S: '34216', T: '72222', U: '55557',
  V: '55552', W: '55775', X: '55255', Y: '55222', Z: '71247',
  0: '75557', 1: '26227', 2: '61247', 3: '61216', 4: '55711', 5: '74616', 6: '34757',
  7: '71122', 8: '75757', 9: '75711',
  ' ': '00000', '.': '00002', ',': '00024', '!': '22202', '?': '61202', ':': '02020',
  '-': '00700', '+': '02720', '_': '00007', '/': '11244', "'": '22000', '"': '55000',
  '(': '24442', ')': '42224', '#': '57575', '*': '05250', '=': '07070', '<': '12421',
  '>': '42124', '&': '25257', '@': '75645', '%': '41247', '$': '36736', '[': '64446',
  ']': '62226', '~': '00630', '^': '25000', ';': '02024', '|': '22222',
};

const CACHE = {};
function glyph(ch) {
  let g = CACHE[ch];
  if (g) return g;
  const s = G[ch] || G[ch.toUpperCase()] || G['?'];
  g = new Uint8Array(15);
  for (let r = 0; r < 5; r++) {
    const v = s.charCodeAt(r) - 48;
    g[r * 3] = (v >> 2) & 1; g[r * 3 + 1] = (v >> 1) & 1; g[r * 3 + 2] = v & 1;
  }
  CACHE[ch] = g;
  return g;
}

/** printable-ASCII version of a name (non-ASCII dropped). */
export function asciiOnly(s) {
  let o = '';
  for (let i = 0; i < (s || '').length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 32 && c < 127) o += s[i];
  }
  return o.trim();
}

export function textWidth(s) { return s.length ? s.length * 4 - 1 : 0; }

/**
 * Draw text. mode: 'over' (post-light overlay, default), 'alb' (lit), 'glow' (emissive k)
 */
export function drawText(c, s, x, y, idx, mode = 'over', k = 1) {
  s = String(s);
  for (let n = 0; n < s.length; n++) {
    const g = glyph(s[n]);
    for (let r = 0; r < 5; r++) for (let q = 0; q < 3; q++) {
      if (!g[r * 3 + q]) continue;
      const X = x + n * 4 + q, Y = y + r;
      if (mode === 'over') opx(c, X, Y, idx);
      else if (mode === 'glow') gpx(c, X, Y, idx, k);
      else px(c, X, Y, idx);
    }
  }
}

/** text with 1px outline in the overlay layer */
export function drawTextOutlined(c, s, x, y, idx, outline) {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) drawText(c, s, x + dx, y + dy, outline);
  drawText(c, s, x, y, idx);
}
