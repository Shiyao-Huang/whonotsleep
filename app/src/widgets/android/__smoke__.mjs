// Smoke test for the pure Android widget render pipeline.
// Run from app/:  node src/widgets/android/__smoke__.mjs
// (Node >= 23.6 strips the TypeScript types of pipeline.ts natively.)
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { MAX_URI_LENGTH, chooseFit, derive, imageAreaDp, meStatusText, renderDerivedImage, roomStatusText } from './pipeline.ts';

export function sampleRoom(now = Date.now()) {
  const tz = 480; // Asia/Shanghai
  const base = { tzOffset: tz, lastSeen: now - 5000, statusSince: now - 20 * 60000, emote: null, say: null, hasComputer: true };
  const av = (i) => ({ skin: i % 6, hair: (i * 3) % 10, hairStyle: i % 6, shirt: (i * 5) % 12, accessory: i % 5 });
  return {
    code: 'K7QXP',
    name: '夜猫子俱乐部',
    createdAt: now - 86400000,
    events: [],
    members: [
      { ...base, id: 'm1', name: 'Shiyao', avatar: av(1), seat: 0, status: 'working', tool: 'claude', detail: 'whonotsleep', goodnightAt: now - 2 * 3600000, statusSince: now - 600000 },
      { ...base, id: 'm2', name: 'Lin', avatar: av(2), seat: 1, status: 'working', tool: 'codex', detail: 'api', goodnightAt: null },
      { ...base, id: 'm3', name: 'Momo', avatar: av(3), seat: 2, status: 'idle', tool: null, detail: null, goodnightAt: null },
      { ...base, id: 'm4', name: '小王', avatar: av(4), seat: 3, status: 'offline', tool: null, detail: null, goodnightAt: now - 3600000, lastSeen: now - 3600000 },
    ],
  };
}

// Fixed "now": 01:30 in UTC+8 so the night-owl joke shows up.
const NOW = Date.UTC(2026, 10, 10, 17, 30);

function pngSize(uri) {
  const b = Buffer.from(uri.split(',')[1], 'base64');
  assert.equal(b.subarray(1, 4).toString('latin1'), 'PNG', 'PNG signature');
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), bytes: b.length };
}

const isMain = import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  // chooseFit sanity
  const f = chooseFit(192, 88, 869, 352);
  assert.ok(Number.isInteger(f.scale) && f.scale >= 3, 'integer scale');
  assert.ok(f.cropW * f.scale <= 869 && f.cropH * f.scale <= 352, 'fits area');

  const room = sampleRoom(NOW);
  const derived = derive(room, NOW);
  console.log('room status:', roomStatusText(derived), '| me:', meStatusText(derived, 'm1'));

  const cases = [
    { widget: 'RoomWidget', layout: 'wide', w: 320, h: 160, density: 2.75 },
    { widget: 'RoomWidget', layout: 'wide', w: 250, h: 110, density: 2 },
    { widget: 'RoomWidget', layout: 'wide', w: 420, h: 260, density: 3.5 },
    { widget: 'MeWidget', layout: 'small', w: 160, h: 160, density: 2.75, focusId: 'm1' },
    { widget: 'MeWidget', layout: 'small', w: 110, h: 110, density: 3, focusId: 'm2' },
    { widget: 'MeWidget', layout: 'small', w: 260, h: 260, density: 3.5, focusId: 'm3' },
  ];
  for (const c of cases) {
    const area = imageAreaDp(c.widget, c.w, c.h);
    const t0 = performance.now();
    const img = renderDerivedImage(derived, { layout: c.layout, focusId: c.focusId ?? null, widthDp: area.width, heightDp: area.height, density: c.density, now: NOW });
    const ms = (performance.now() - t0).toFixed(1);
    const p = pngSize(img.uri);
    assert.equal(p.w, img.widthPx);
    assert.equal(p.h, img.heightPx);
    assert.equal(Math.round(img.widthDp * c.density), img.widthPx, 'dp->px rounds back exactly (crisp)');
    assert.equal(Math.round(img.heightDp * c.density), img.heightPx);
    assert.ok(img.widthPx <= Math.round(area.width * c.density) + 1 && img.heightPx <= Math.round(area.height * c.density) + 1, 'fits area');
    assert.ok(img.uriLength < MAX_URI_LENGTH, `data URI < 400KB (${img.uriLength})`);
    console.log(
      `${c.widget.padEnd(10)} ${c.w}x${c.h}dp @${c.density}: scale ${img.scale} -> ${p.w}x${p.h}px, png ${(p.bytes / 1024).toFixed(1)}KB, uri ${(img.uriLength / 1024).toFixed(1)}KB, ${ms}ms`,
    );
  }
  // no-session state renders an empty room
  const empty = renderDerivedImage(derive({ code: '', members: [] }, NOW), { layout: 'wide', widthDp: 312, heightDp: 126, density: 2.75, now: NOW });
  assert.ok(empty.uriLength < MAX_URI_LENGTH);
  console.log('empty room ok', (empty.uriLength / 1024).toFixed(1) + 'KB');
  console.log('SMOKE OK');
}
