// Node-only preview: renders fixture scenes to shared/previews/*.png (scale 4).
// usage: node shared/preview.mjs [--bench] [--t=ms]
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveScene, avatarFromSeed } from './protocol.js';
import { encodePNG } from './png.js';
import { renderScene, renderAvatar } from './scene.js';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'previews');
mkdirSync(OUT, { recursive: true });
const deflate = (u8) => new Uint8Array(deflateSync(u8, { level: 9 }));
const arg = (k, d) => { const a = process.argv.find((s) => s.startsWith('--' + k)); return a ? (a.split('=')[1] ?? true) : d; };
const T = Number(arg('t', 1234));

const TZ = 480;
/** epoch ms when local time (tz +8) is hh:mm */
const at = (hh, mm = 0) => Date.UTC(2026, 10, 10, hh, mm) - TZ * 60000;
const MIN = 60000;

function member(id, name, seat, status, tool, now, o = {}) {
  return {
    id, name, seat, status, tool: status === 'working' ? tool : null, detail: o.detail || null,
    avatar: o.avatar || avatarFromSeed(name), tzOffset: TZ,
    lastSeen: now - (o.offline ? 3600_000 : 5000), statusSince: now - (o.since ?? 20) * MIN,
    goodnightAt: o.gn != null ? now - o.gn * MIN : null,
    emote: o.emote ? { kind: o.emote, at: now - 1000, from: null } : null,
    say: o.say ? { text: o.say, at: now - 1000 } : null, hasComputer: true,
  };
}
const room = (members) => ({ code: 'NIGHT', name: 'owls', createdAt: 0, members, events: [] });

const fixtures = {};
{ const now = at(1, 30);
  fixtures.night_owl = { now, room: room([
    member('a', 'Ann', 0, 'working', 'claude', now, { gn: 90, since: 10, avatar: { skin: 1, hair: 0, hairStyle: 1, shirt: 0, accessory: 1 } }),
    member('b', 'Bo', 1, 'idle', null, now, { gn: 120, avatar: { skin: 2, hair: 2, hairStyle: 0, shirt: 5, accessory: 2 } }),
    member('c', 'Cy', 2, 'offline', null, now, { offline: true, gn: 100, avatar: { skin: 0, hair: 4, hairStyle: 3, shirt: 6, accessory: 4 } }),
    member('d', 'Dee', 3, 'offline', null, now, { offline: true, avatar: { skin: 3, hair: 1, hairStyle: 2, shirt: 3, accessory: 3 } }),
  ]) }; }
{ const now = at(14, 0);
  fixtures.day_work = { now, room: room([
    member('a', 'Ann', 0, 'working', 'claude', now),
    member('b', 'Bo', 1, 'working', 'codex', now),
    member('c', 'Cy', 2, 'working', 'gemini', now, { emote: 'heart' }),
  ]) }; }
{ const now = at(18, 30);
  fixtures.dusk_mixed = { now, room: room([
    member('a', 'Mika', 0, 'idle', null, now),
    member('b', 'Jun', 1, 'away', null, now),
    member('c', 'Leo', 2, 'working', 'cursor', now, { say: 'ship it!' }),
  ]) }; }
{ const now = at(6, 10);
  fixtures.dawn = { now, room: room([
    member('a', 'Sol', 0, 'working', 'aider', now),
    member('b', 'Kai', 1, 'offline', null, now, { offline: true, gn: 400 }),
    member('c', 'Rin', 2, 'idle', null, now, { emote: 'note' }),
  ]) }; }
{ const now = at(23, 40);
  const tools = ['claude', 'codex', 'gemini', 'copilot', 'amp', 'opencode'];
  const st = ['working', 'working', 'idle', 'working', 'away', 'working'];
  fixtures.six_members = { now, room: room(['Ann', 'Bo', 'Cy', 'Dee', 'Eve', 'Fay'].map((n, i) =>
    member('m' + i, n, i, st[i], tools[i], now, i === 4 ? { gn: 30 } : {}))) }; }
{ const now = at(22, 15);
  const em = ['question', 'exclaim', 'zzz', 'heart', 'note', 'sweat'];
  const st = ['working', 'idle', 'working', 'idle', 'working', 'away'];
  fixtures.emotes_a = { now, room: room(['Ann', '小明', 'Cy', 'Dee', 'Eve', 'Fay'].map((n, i) =>
    member('e' + i, n, i, st[i], ['claude', null, 'codex', null, 'amp', null][i], now, { emote: em[i], say: i === 1 ? '晚安啦各位' : i === 4 ? 'one more bug then bed' : null }))) }; }
{ const now = at(2, 40);
  const em = ['star', 'wave', 'angry', 'moon', null, null];
  const st = ['working', 'idle', 'offline', 'offline', 'working', 'idle'];
  fixtures.emotes_b = { now, room: room(['Max', 'Noa', 'Oli', 'Pia', 'Q', 'Rae'].map((n, i) =>
    member('f' + i, n, i, st[i], ['gemini', null, null, null, 'copilot', null][i], now, { emote: em[i], offline: st[i] === 'offline', gn: i >= 2 ? 200 : null }))) }; }
fixtures.wide_six = { ...fixtures.six_members, layout: 'wide' };
fixtures.small_six = { ...fixtures.six_members, layout: 'small', focusId: 'm5' };
fixtures.small_focus = { ...fixtures.night_owl, layout: 'small', focusId: 'a' };
fixtures.small_sleep = { ...fixtures.night_owl, layout: 'small', focusId: 'b' };
fixtures.wide = { ...fixtures.night_owl, layout: 'wide' };
fixtures.wide_day = { ...fixtures.day_work, layout: 'wide' };

const only = arg('only', null);
for (const [name, f] of Object.entries(fixtures)) {
  if (only && !String(only).split(',').includes(name)) continue;
  const d = deriveScene(f.room, f.now);
  const img = renderScene(d, { layout: f.layout || 'room', t: T, focusId: f.focusId || null });
  writeFileSync(join(OUT, name + '.png'), encodePNG(img.width, img.height, img.data, { scale: 4, deflate }));
}

// avatar sheet: 24 portraits in a 6x4 grid
if (!only || String(only).includes('avatar_sheet')) {
  const S = 64, cols = 6, rows = 4, pad = 4;
  const W = cols * (S + pad) + pad, H = rows * (S + pad) + pad;
  const sheet = new Uint8ClampedArray(W * H * 4).fill(255);
  for (let i = 0; i < W * H; i++) { sheet[i * 4] = 8; sheet[i * 4 + 1] = 8; sheet[i * 4 + 2] = 26; }
  for (let n = 0; n < 24; n++) {
    const av = { skin: n % 6, hair: (n * 7) % 10, hairStyle: n % 6, shirt: (n * 5) % 12, accessory: Math.floor(n / 6 + n) % 5 };
    const a = renderAvatar(av, { t: T, size: S });
    const ox = pad + (n % cols) * (S + pad), oy = pad + Math.floor(n / cols) * (S + pad);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const s = (y * S + x) * 4, d = ((oy + y) * W + ox + x) * 4;
      sheet[d] = a.data[s]; sheet[d + 1] = a.data[s + 1]; sheet[d + 2] = a.data[s + 2];
    }
  }
  writeFileSync(join(OUT, 'avatar_sheet.png'), encodePNG(W, H, sheet, { scale: 2, deflate }));
}

if (arg('bench', false)) {
  const f = fixtures.night_owl;
  const d = deriveScene(f.room, f.now);
  for (let i = 0; i < 10; i++) renderScene(d, { layout: 'room', t: i * 66 });
  const N = 60, t0 = performance.now();
  for (let i = 0; i < N; i++) renderScene(d, { layout: 'room', t: i * 66 });
  const ms = (performance.now() - t0) / N;
  const d2 = deriveScene(fixtures.six_members.room, fixtures.six_members.now);
  const t1 = performance.now();
  for (let i = 0; i < N; i++) renderScene(d2, { layout: 'room', t: i * 66 });
  console.log(`renderScene(room) night_owl ${ms.toFixed(2)} ms/frame, six_members ${((performance.now() - t1) / N).toFixed(2)} ms/frame`);
}
console.log('wrote previews to', OUT);
