#!/usr/bin/env node
// Renders sample WhoNotSleep scenes into the iOS widget target's asset catalog.
// These are used by the widget's placeholder()/gallery preview and as the offline
// fallback when no cached PNG exists yet.
//
//   node app/scripts/make-ios-widget-assets.mjs
//
// Output: app/targets/widget/Assets.xcassets/placeholder_{small,wide,room}.imageset/
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const shared = (f) => pathToFileURL(path.join(root, 'shared', f)).href;

const { deriveScene } = await import(shared('protocol.js'));
const { renderScene } = await import(shared('scene.js'));
const { encodePNG } = await import(shared('png.js'));

const SCALE = 4;
const deflate = (bytes) => new Uint8Array(zlib.deflateSync(bytes, { level: 9 }));

// Fixed "now": 01:40 in Asia/Shanghai (UTC+8) so the room is in its night palette.
const now = Date.UTC(2026, 10, 10, 17, 40, 0);
const tz = 480;
const min = 60_000;
const avatar = (skin, hair, hairStyle, shirt, accessory) => ({ skin, hair, hairStyle, shirt, accessory });

const room = {
  code: 'MOON7',
  name: '谁还没睡',
  createdAt: now - 7 * 86400_000,
  events: [],
  members: [
    { // night owl: said goodnight, back on Claude Code after midnight -> caught "!"
      id: 'me', name: 'Me', avatar: avatar(1, 2, 1, 3, 1), seat: 0,
      status: 'working', tool: 'claude', detail: 'whonotsleep', tzOffset: tz,
      lastSeen: now - 5_000, statusSince: now - 25 * min, goodnightAt: now - 120 * min,
      emote: null, say: null, hasComputer: true,
    },
    { // asleep -> big "?" over head
      id: 'b', name: 'Bao', avatar: avatar(3, 5, 3, 7, 4), seat: 1,
      status: 'offline', tool: null, detail: null, tzOffset: tz,
      lastSeen: now - 180 * min, statusSince: now - 180 * min, goodnightAt: now - 170 * min,
      emote: null, say: null, hasComputer: true,
    },
    { // still coding with Codex, never said goodnight
      id: 'c', name: 'Kai', avatar: avatar(0, 8, 4, 10, 2), seat: 2,
      status: 'working', tool: 'codex', detail: 'api', tzOffset: tz,
      lastSeen: now - 3_000, statusSince: now - 70 * min, goodnightAt: null,
      emote: null, say: null, hasComputer: true,
    },
  ],
};

const derived = deriveScene(room, now);
const outRoot = path.join(root, 'app/targets/widget/Assets.xcassets');
fs.mkdirSync(outRoot, { recursive: true });
fs.writeFileSync(
  path.join(outRoot, 'Contents.json'),
  JSON.stringify({ info: { author: 'xcode', version: 1 } }, null, 2) + '\n',
);

for (const layout of ['small', 'wide', 'room']) {
  const frame = renderScene(derived, { layout, t: 1234, focusId: 'me' });
  const png = encodePNG(frame.width, frame.height, frame.data, { scale: SCALE, deflate });
  const name = `placeholder_${layout}`;
  const dir = path.join(outRoot, `${name}.imageset`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.png`), png);
  fs.writeFileSync(
    path.join(dir, 'Contents.json'),
    JSON.stringify(
      { images: [{ filename: `${name}.png`, idiom: 'universal' }], info: { author: 'xcode', version: 1 } },
      null,
      2,
    ) + '\n',
  );
  console.log(`${name}: ${frame.width}x${frame.height} @${SCALE}x -> ${png.length} bytes`);
}
