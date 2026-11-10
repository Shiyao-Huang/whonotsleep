#!/usr/bin/env node
// Renders a sample room (wide layout, scale 3) to app/assets/widget-preview.png,
// used as the Android widget picker previewImage.
// Run from app/:  node scripts/make-widget-preview.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveScene } from '../../shared/protocol.js';
import { renderScene } from '../../shared/scene.js';
import { encodePNG } from '../../shared/png.js';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../assets/widget-preview.png');

// 01:30 local (UTC+8): one caught night owl, a coder, a sleeper with "?".
const now = Date.UTC(2026, 10, 10, 17, 30);
const base = { tzOffset: 480, lastSeen: now - 5000, statusSince: now - 20 * 60000, emote: null, say: null, hasComputer: true };
const av = (i) => ({ skin: i % 6, hair: (i * 3) % 10, hairStyle: i % 6, shirt: (i * 5) % 12, accessory: i % 5 });
const room = {
  code: 'K7QXP',
  name: 'WhoNotSleep',
  createdAt: now - 86400000,
  events: [],
  members: [
    { ...base, id: 'm1', name: 'Shiyao', avatar: av(1), seat: 0, status: 'working', tool: 'claude', detail: 'whonotsleep', goodnightAt: now - 2 * 3600000, statusSince: now - 600000 },
    { ...base, id: 'm2', name: 'Lin', avatar: av(2), seat: 1, status: 'working', tool: 'codex', detail: null, goodnightAt: null },
    { ...base, id: 'm3', name: 'Momo', avatar: av(3), seat: 2, status: 'idle', tool: null, detail: null, goodnightAt: null },
    { ...base, id: 'm4', name: 'Wang', avatar: av(4), seat: 3, status: 'offline', tool: null, detail: null, goodnightAt: now - 3600000, lastSeen: now - 3600000 },
  ],
};

const frame = renderScene(deriveScene(room, now), { layout: 'wide', t: 1200, focusId: null });
const png = encodePNG(frame.width, frame.height, frame.data, { scale: 3, deflate: (d) => new Uint8Array(deflateSync(d, { level: 9 })) });
writeFileSync(out, png);
console.log(`wrote ${out} (${frame.width * 3}x${frame.height * 3}, ${(png.length / 1024).toFixed(1)}KB)`);
