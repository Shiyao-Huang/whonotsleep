// Tiny zero-dep terminal styling.
const useColor = () => !process.env.NO_COLOR && (process.env.FORCE_COLOR || process.stdout.isTTY);

const wrap = (open, close = 39) => (s) => (useColor() ? `\x1b[${open}m${s}\x1b[${close}m` : String(s));
export const c = {
  bold: wrap(1, 22), dim: wrap(2, 22), italic: wrap(3, 23),
  red: wrap(31), green: wrap(32), yellow: wrap(33), blue: wrap(34), magenta: wrap(35), cyan: wrap(36), gray: wrap(90),
  rgb: (r, g, b) => (s) => (useColor() ? `\x1b[38;2;${r};${g};${b}m${s}\x1b[39m` : String(s)),
};

const moon = c.rgb(255, 214, 120);
const night = c.rgb(120, 140, 255);
const coral = c.rgb(217, 119, 87);

export function banner() {
  // 2 text rows = 4 "pixel" rows with half blocks
  const l1 = `${moon(' ▄▀▀▄')}  ${night('█ █ █ █▀▀▄ ▄▀▀▀')}`;
  const l2 = `${moon(' ▀▄▄▀')}${c.yellow('*')} ${night('▀▄▀▄▀ █  █ ▄▄▄▀')}  ${c.bold('谁还没睡')} ${c.gray('· whonotsleep')}`;
  return `\n${l1}\n${l2}\n`;
}

/** Strip terminal control chars (C0/C1/DEL, bidi overrides) from untrusted server strings. */
export const clean = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '');

export const ok = (s) => console.log(`${c.green('✔')} ${s}`);
export const info = (s) => console.log(`${c.cyan('›')} ${s}`);
export const warn = (s) => console.log(`${c.yellow('!')} ${s}`);
export const fail = (s) => console.error(`${c.red('✘')} ${s}`);

export function ago(ms) {
  if (ms == null || !isFinite(ms) || ms < 0) return '?';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h${m % 60 ? `${m % 60}m` : ''}`;
  return `${Math.floor(h / 24)}d`;
}

export const STATUS_STYLE = {
  working: { icon: '⌨', color: (s) => coral(s), zh: '在肝' },
  idle: { icon: '☕', color: c.green, zh: '在线摸鱼' },
  away: { icon: '·', color: c.yellow, zh: '离开座位' },
  offline: { icon: '○', color: c.gray, zh: '离线' },
};

export const POSE_ZH = {
  typing: '敲键盘中', sitting: '坐着发呆', empty: '椅子空着', sleeping: '睡觉 zzZ', gone: '不在',
};

export { coral, night, moon };
