// node --test test.mjs   (Node >= 20)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { createApp } from './app.js';
import { deriveScene, MAX_MEMBERS } from '../shared/protocol.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wns-test-'));
const dataFile = path.join(tmpDir, 'rooms.json');

let skew = 0;
const clock = () => Date.now() + skew;

// tzOffset (minutes) such that local time is `hour`:30 right now; kept in [-720, 720)
function tzFor(hour) {
  const utcMin = Math.floor(clock() / 60000) % 1440;
  let tz = (((hour * 60 + 30) - utcMin) % 1440 + 1440) % 1440;
  if (tz >= 720) tz -= 1440;
  return tz;
}

// Renderer: real one if shared/scene.js exists, otherwise a test-only stub (never written to shared/).
const hasRealRenderer = fs.existsSync(path.join(here, '../shared/scene.js')) && fs.existsSync(path.join(here, '../shared/png.js'));
let renderCalls = 0;
async function loadRenderer() {
  let r;
  if (hasRealRenderer) {
    const [scene, png] = await Promise.all([import('../shared/scene.js'), import('../shared/png.js')]);
    r = { renderScene: scene.renderScene, encodePNG: png.encodePNG };
  } else {
    r = {
      renderScene: (_d, { layout }) => {
        const [w, h] = layout === 'small' ? [96, 96] : layout === 'wide' ? [192, 88] : [192, 120];
        return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(200) };
      },
      encodePNG: stubEncodePNG,
    };
  }
  return { renderScene: (...a) => { renderCalls++; return r.renderScene(...a); }, encodePNG: r.encodePNG };
}
function stubEncodePNG(w, h, rgba, { scale = 1, deflate }) {
  // minimal valid PNG (CRC zeroed is fine for signature/size checks in tests)
  const W = w * scale, H = h * scale;
  const raw = new Uint8Array((W * 4 + 1) * H);
  const crcless = (type, data) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4); Buffer.from(data).copy(b, 8); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
  void rgba;
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), crcless('IHDR', ihdr), crcless('IDAT', deflate(raw)), crcless('IEND', Buffer.alloc(0))]));
}

let app, base, wsBase;
before(async () => {
  app = createApp({ dataFile, saveDebounceMs: 20, tickMs: 3_600_000, now: clock, loadRenderer, log: () => {} });
  const addr = await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${addr.port}`;
  wsBase = `ws://127.0.0.1:${addr.port}`;
});
after(async () => { await app?.close(); fs.rmSync(tmpDir, { recursive: true, force: true }); });

async function api(method, p, { token, body, raw } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + p, { method, headers, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : ct.includes('image') ? Buffer.from(await res.arrayBuffer()) : await res.text();
  return { status: res.status, data, headers: res.headers };
}

const S = {}; // shared state across sequential tests

test('healthz + CORS', async () => {
  const r = await api('GET', '/healthz');
  assert.equal(r.status, 200);
  assert.equal(r.data, 'ok');
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  const o = await fetch(base + '/api/me/report', { method: 'OPTIONS' });
  assert.equal(o.status, 204);
  assert.match(o.headers.get('access-control-allow-headers'), /Authorization/);
});

test('create room + join', async () => {
  const c = await api('POST', '/api/rooms', { body: { name: 'Night Lab', member: { name: 'Alice', avatar: { skin: 1, hair: 2, hairStyle: 3, shirt: 4, accessory: 1 }, tzOffset: tzFor(1) } } });
  assert.equal(c.status, 201);
  assert.match(c.data.room.code, /^[A-HJKMNP-Z2-9]{5}$/);
  assert.equal(c.data.room.name, 'Night Lab');
  assert.match(c.data.token, /^[0-9a-f]{64}$/);
  assert.equal(c.data.room.members[0].seat, 0);
  assert.ok(!JSON.stringify(c.data.room).includes(c.data.token), 'token must not leak into room');
  S.code = c.data.room.code; S.a = { id: c.data.memberId, token: c.data.token };

  const j = await api('POST', `/api/rooms/${S.code.toLowerCase()}/join`, { body: { member: { name: 'Bob', tzOffset: tzFor(14) } } });
  assert.equal(j.status, 200);
  assert.equal(j.data.room.members.length, 2);
  const bob = j.data.room.members.find((m) => m.id === j.data.memberId);
  assert.equal(bob.seat, 1);
  assert.equal(typeof bob.avatar.hair, 'number'); // default avatar from seed
  assert.ok(!JSON.stringify(j.data.room).includes(S.a.token));
  assert.ok(!JSON.stringify(j.data.room).includes(j.data.token));
  S.b = { id: j.data.memberId, token: j.data.token };
  assert.deepEqual(j.data.room.events.map((e) => e.kind), ['joined', 'joined']);
});

test('websocket: snapshot on connect, rejects bad token', async () => {
  const ws = new WebSocket(`${wsBase}/ws?room=${S.code}&token=${S.b.token}`);
  S.wsMsgs = [];
  const first = new Promise((resolve, reject) => {
    ws.on('message', (d) => { const m = JSON.parse(String(d)); S.wsMsgs.push(m); if (S.wsMsgs.length === 1) resolve(m); });
    ws.on('error', reject);
  });
  const m = await first;
  assert.equal(m.type, 'room');
  assert.equal(m.room.code, S.code);
  assert.equal(typeof m.now, 'number');
  S.ws = ws;
  // ping -> pong
  const pong = new Promise((resolve) => ws.on('message', (d) => { const x = JSON.parse(String(d)); if (x.type === 'pong') resolve(x); }));
  ws.send(JSON.stringify({ type: 'ping' }));
  assert.equal((await pong).type, 'pong');

  const badWs = new WebSocket(`${wsBase}/ws?room=${S.code}&token=nope`);
  const status = await new Promise((resolve) => {
    badWs.on('unexpected-response', (_req, res) => resolve(res.statusCode));
    badWs.on('error', () => resolve('error'));
  });
  assert.equal(status, 401);
});

test('link code + link (single use)', async () => {
  const lc = await api('POST', '/api/me/linkcode', { token: S.a.token });
  assert.equal(lc.status, 200);
  assert.match(lc.data.linkCode, /^[A-HJKMNP-Z2-9]{6}$/);
  assert.ok(lc.data.expiresAt > clock() + 9 * 60_000);
  const l = await api('POST', '/api/link', { body: { linkCode: lc.data.linkCode.toLowerCase() } });
  assert.equal(l.status, 200);
  assert.deepEqual(l.data, { token: S.a.token, memberId: S.a.id, roomCode: S.code, name: 'Alice' });
  const again = await api('POST', '/api/link', { body: { linkCode: lc.data.linkCode } });
  assert.equal(again.status, 404);
  assert.ok(again.data.error);
  const missing = await api('POST', '/api/link', { body: {} });
  assert.equal(missing.status, 400);
  // expiry
  const lc2 = await api('POST', '/api/me/linkcode', { token: S.a.token });
  skew += 10 * 60_000 + 1000;
  const expired = await api('POST', '/api/link', { body: { linkCode: lc2.data.linkCode } });
  skew -= 10 * 60_000 + 1000;
  assert.equal(expired.status, 404);
  const r = await api('GET', `/api/rooms/${S.code}`);
  assert.equal(r.data.room.members.find((m) => m.id === S.a.id).hasComputer, true);
});

test('report working claude', async () => {
  const r = await api('POST', '/api/me/report', { token: S.a.token, body: { status: 'working', tool: 'claude', detail: 'whonotsleep', tzOffset: tzFor(1) } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { ok: true });
  const g = await api('GET', `/api/rooms/${S.code}`);
  const a = g.data.room.members.find((m) => m.id === S.a.id);
  assert.equal(a.status, 'working');
  assert.equal(a.tool, 'claude');
  assert.equal(a.detail, 'whonotsleep');
  const ev = g.data.room.events.at(-1);
  assert.equal(ev.kind, 'started');
  assert.match(ev.text, /Claude Code/);
  const bad = await api('POST', '/api/me/report', { token: S.a.token, body: { status: 'dancing' } });
  assert.equal(bad.status, 400);
  // Bob reports idle (online, at desk)
  assert.equal((await api('POST', '/api/me/report', { token: S.b.token, body: { status: 'idle' } })).status, 200);
});

test('goodnight + night owl caught (event once) + badges', async () => {
  // Bob says goodnight and is idle -> sleeping
  assert.equal((await api('POST', '/api/me/goodnight', { token: S.b.token })).status, 200);
  // Alice says goodnight at 01:30 local but claude is still running -> caught
  assert.equal((await api('POST', '/api/me/goodnight', { token: S.a.token })).status, 200);
  // heartbeat again: must not duplicate the caught event
  await api('POST', '/api/me/report', { token: S.a.token, body: { status: 'working', tool: 'claude', detail: 'whonotsleep' } });
  const g = await api('GET', `/api/rooms/${S.code}`);
  const caught = g.data.room.events.filter((e) => e.kind === 'caught-night-owl');
  assert.equal(caught.length, 1);
  assert.equal(caught[0].memberId, S.a.id);
  const d = deriveScene(g.data.room, clock());
  const a = d.members.find((m) => m.id === S.a.id);
  const b = d.members.find((m) => m.id === S.b.id);
  assert.equal(a.nightOwl, true);
  assert.equal(a.badge, 'caught');
  assert.equal(b.pose, 'sleeping');
  assert.equal(b.badge, 'question');
  assert.deepEqual(d.owls, [S.a.id]);
});

test('morning clears goodnight', async () => {
  await api('POST', '/api/me/morning', { token: S.b.token });
  let g = await api('GET', `/api/rooms/${S.code}`);
  assert.equal(g.data.room.members.find((m) => m.id === S.b.id).goodnightAt, null);
  assert.equal(g.data.room.events.at(-1).kind, 'morning');
  await api('POST', '/api/me/goodnight', { token: S.b.token });
  g = await api('GET', `/api/rooms/${S.code}`);
  assert.ok(g.data.room.members.find((m) => m.id === S.b.id).goodnightAt);
});

test('emote + say + patch', async () => {
  const e = await api('POST', '/api/me/emote', { token: S.b.token, body: { kind: 'question', to: S.a.id } });
  assert.equal(e.status, 200);
  assert.equal((await api('POST', '/api/me/emote', { token: S.b.token, body: { kind: 'nope' } })).status, 400);
  assert.equal((await api('POST', '/api/me/emote', { token: S.b.token, body: { kind: 'heart', to: 'ghost' } })).status, 400);
  const s = await api('POST', '/api/me/say', { token: S.a.token, body: { text: '马上就睡!' } });
  assert.equal(s.status, 200);
  assert.equal((await api('POST', '/api/me/say', { token: S.a.token, body: { text: 'x'.repeat(81) } })).status, 400);
  assert.equal((await api('POST', '/api/me/say', { token: S.a.token, body: { text: '   ' } })).status, 400);
  const p = await api('PATCH', '/api/me', { token: S.b.token, body: { name: 'Bobby', avatar: { accessory: 4 } } });
  assert.equal(p.status, 200);
  assert.equal((await api('PATCH', '/api/me', { token: S.b.token, body: { avatar: { skin: 99 } } })).status, 400);

  const g = await api('GET', `/api/rooms/${S.code}`);
  const a = g.data.room.members.find((m) => m.id === S.a.id);
  const b = g.data.room.members.find((m) => m.id === S.b.id);
  assert.deepEqual({ kind: a.emote.kind, from: a.emote.from }, { kind: 'question', from: S.b.id });
  assert.equal(a.say.text, '马上就睡!');
  assert.equal(b.name, 'Bobby');
  assert.equal(b.avatar.accessory, 4);
  const d = deriveScene(g.data.room, clock());
  assert.equal(d.members.find((m) => m.id === S.a.id).activeEmote.kind, 'question');
  assert.equal(d.members.find((m) => m.id === S.a.id).activeSay.text, '马上就睡!');
  const kinds = g.data.room.events.map((x) => x.kind);
  assert.ok(kinds.includes('emote') && kinds.includes('say'));
});

test('ws broadcast received after changes', async () => {
  // wait briefly for in-flight frames
  await new Promise((r) => setTimeout(r, 50));
  const rooms = S.wsMsgs.filter((m) => m.type === 'room');
  assert.ok(rooms.length >= 8, `expected many broadcasts, got ${rooms.length}`);
  const last = rooms.at(-1).room;
  assert.ok(last.events.some((e) => e.kind === 'caught-night-owl'));
  assert.equal(last.members.find((m) => m.id === S.b.id).name, 'Bobby');
  for (const m of rooms) assert.ok(!JSON.stringify(m).includes(S.a.token) && !JSON.stringify(m).includes(S.b.token));
  // 30s tick also broadcasts
  const n = S.wsMsgs.length;
  app.tick();
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(S.wsMsgs.length > n);
});

test('auth errors, 404, 409 full room, 413 body limit', async () => {
  assert.equal((await api('POST', '/api/me/goodnight')).status, 401);
  const bad = await api('POST', '/api/me/goodnight', { token: 'deadbeef' });
  assert.equal(bad.status, 401);
  assert.ok(bad.data.error);
  assert.equal((await api('POST', '/api/me/linkcode')).status, 401);
  assert.equal((await api('GET', '/api/rooms/ZZZZZ')).status, 404);
  assert.equal((await api('POST', '/api/rooms/ZZZZZ/join', { body: { member: { name: 'x' } } })).status, 404);
  assert.equal((await api('POST', `/api/rooms/${S.code}/join`, { body: { member: { name: '' } } })).status, 400);
  assert.equal((await api('POST', '/api/rooms', { raw: '{nope', body: undefined })).status, 400);
  assert.equal((await api('POST', '/api/rooms', { body: { member: { name: 'x' }, pad: 'y'.repeat(17 * 1024) } })).status, 413);
  assert.equal((await api('GET', '/api/nothing')).status, 404);
  const extra = [];
  for (let i = 2; i < MAX_MEMBERS; i++) {
    const j = await api('POST', `/api/rooms/${S.code}/join`, { body: { member: { name: `P${i}` } } });
    assert.equal(j.status, 200);
    extra.push(j.data);
  }
  assert.deepEqual(extra.map((x) => x.room.members.find((m) => m.id === x.memberId).seat), [2, 3, 4, 5]);
  const full = await api('POST', `/api/rooms/${S.code}/join`, { body: { member: { name: 'Late' } } });
  assert.equal(full.status, 409);
  assert.ok(full.data.error);
  // free seat 3, next joiner takes lowest free seat
  await api('DELETE', '/api/me', { token: extra[1].token });
  const j = await api('POST', `/api/rooms/${S.code}/join`, { body: { member: { name: 'Seat3' } } });
  assert.equal(j.data.room.members.find((m) => m.id === j.data.memberId).seat, 3);
});

test('heartbeat timeout -> offline + stopped event', async () => {
  skew += 91_000;
  app.tick();
  const g = await api('GET', `/api/rooms/${S.code}`);
  const a = g.data.room.members.find((m) => m.id === S.a.id);
  assert.equal(a.status, 'offline');
  assert.equal(a.tool, null);
  assert.ok(g.data.room.events.some((e) => e.kind === 'stopped' && e.memberId === S.a.id));
  // comes back working -> caught again (new episode)
  await api('POST', '/api/me/report', { token: S.a.token, body: { status: 'working', tool: 'codex' } });
  const g2 = await api('GET', `/api/rooms/${S.code}`);
  assert.equal(g2.data.room.events.filter((e) => e.kind === 'caught-night-owl').length, 2);
});

test('leave', async () => {
  const r = await api('DELETE', '/api/me', { token: S.b.token });
  assert.equal(r.status, 200);
  assert.equal((await api('POST', '/api/me/goodnight', { token: S.b.token })).status, 401);
  const g = await api('GET', `/api/rooms/${S.code}`);
  assert.ok(!g.data.room.members.some((m) => m.id === S.b.id));
  assert.ok(g.data.room.events.some((e) => e.kind === 'left' && e.memberId === S.b.id));
  S.ws.close();
});

test('persistence to rooms.json and reload', async () => {
  await new Promise((r) => setTimeout(r, 100));
  const saved = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  assert.ok(saved.rooms.some((r) => r.code === S.code));
  const app2 = createApp({ dataFile, now: clock, log: () => {} });
  const addr = await app2.listen(0, '127.0.0.1');
  try {
    const res = await fetch(`http://127.0.0.1:${addr.port}/api/rooms/${S.code}`);
    const { room } = await res.json();
    assert.ok(room.members.some((m) => m.id === S.a.id));
    const gn = await fetch(`http://127.0.0.1:${addr.port}/api/me/morning`, { method: 'POST', headers: { Authorization: `Bearer ${S.a.token}` } });
    assert.equal(gn.status, 200, 'token survives restart');
  } finally {
    await app2.close();
  }
});

test('per-IP rate limit -> 429', async () => {
  const app3 = createApp({ rateLimit: { perMinute: 60, burst: 3 }, log: () => {} });
  const addr = await app3.listen(0, '127.0.0.1');
  try {
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await fetch(`http://127.0.0.1:${addr.port}/healthz`)).status);
    assert.deepEqual(codes, [200, 200, 200, 429, 429]);
    // a different client IP behind the proxy has its own bucket
    const other = await fetch(`http://127.0.0.1:${addr.port}/healthz`, { headers: { 'X-Forwarded-For': '203.0.113.9' } });
    assert.equal(other.status, 200);
  } finally {
    await app3.close();
  }
});

// PNG endpoint last: renderer (shared/scene.js) may be written in parallel.
test(`scene.png (${hasRealRenderer ? 'real renderer' : 'stub renderer'})`, async () => {
  const r = await api('GET', `/api/rooms/${S.code}/scene.png?layout=room&scale=2&focus=${S.a.id}`);
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
  assert.equal(r.headers.get('content-type'), 'image/png');
  assert.match(r.headers.get('cache-control'), /max-age=10/);
  assert.deepEqual([...r.data.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(r.data.readUInt32BE(16), 192 * 2);
  assert.equal(r.data.readUInt32BE(20), 120 * 2);
  const calls = renderCalls;
  const r2 = await api('GET', `/api/rooms/${S.code}/scene.png?layout=room&scale=2&focus=${S.a.id}`);
  assert.equal(r2.status, 200);
  assert.equal(renderCalls, calls, 'second request served from cache');
  const small = await api('GET', `/api/rooms/${S.code}/scene.png?layout=small&scale=9`);
  assert.equal(small.status, 200);
  assert.equal(small.data.readUInt32BE(16), 96 * 6); // scale clamped to 6
  const def = await api('GET', `/api/rooms/${S.code}/scene.png`);
  assert.equal(def.data.readUInt32BE(16), 192 * 4); // default scale 4
  assert.equal((await api('GET', `/api/rooms/${S.code}/scene.png?layout=huge`)).status, 400);
  assert.equal((await api('GET', '/api/rooms/ZZZZZ/scene.png')).status, 404);
});

test('ai proxy: auth, model forced, thinking stripped, key never leaks, rate limit', async () => {
  const SECRET = 'sk-test-SECRET-should-never-leak';
  let seen = null;
  const aiFetch = async (url, init) => {
    seen = { url, headers: init.headers, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ id: 'm1', content: [
      { type: 'thinking', thinking: 'internal' },
      { type: 'text', text: '好的' },
      { type: 'tool_use', id: 't1', name: 'goodnight', input: {} },
    ], stop_reason: 'tool_use', usage: { input_tokens: 5, output_tokens: 3 } }), { status: 200 });
  };
  const a = createApp({ log: () => {}, ai: { available: true, baseUrl: 'https://up.example', key: SECRET, model: 'glm-x' }, aiFetch, aiRateLimit: { perMinute: 60, burst: 2 } });
  await a.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${a.server.address().port}`;
  const post = (p, body, tok) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, body: JSON.stringify(body) });
  try {
    const st = await (await fetch(base + '/api/ai/status')).json();
    assert.deepEqual(st, { available: true, model: 'glm-x' });
    const created = await (await post('/api/rooms', { member: { name: 'ai', tzOffset: 0 } })).json();
    const msgs = { messages: [{ role: 'user', content: 'hi' }], tools: [{ name: 'goodnight', description: 'x', input_schema: { type: 'object', properties: {} } }], max_tokens: 99999, model: 'evil-model' };
    assert.equal((await post('/api/ai/messages', msgs)).status, 401);
    const r = await post('/api/ai/messages', msgs, created.token);
    assert.equal(r.status, 200);
    const text = await r.text();
    assert.ok(!text.includes(SECRET), 'key leaked in response');
    const j = JSON.parse(text);
    assert.deepEqual(j.content.map((b) => b.type), ['text', 'tool_use']);
    assert.equal(j.stop_reason, 'tool_use');
    assert.equal(seen.url, 'https://up.example/v1/messages');
    assert.equal(seen.body.model, 'glm-x');
    assert.equal(seen.body.max_tokens, 1024);
    assert.deepEqual(seen.body.thinking, { type: 'disabled' });
    assert.equal(seen.headers['x-api-key'], SECRET);
    assert.equal((await post('/api/ai/messages', { messages: [] }, created.token)).status, 400);
    await post('/api/ai/messages', msgs, created.token);
    assert.equal((await post('/api/ai/messages', msgs, created.token)).status, 429);
    const room = await (await fetch(`${base}/api/rooms/${created.room.code}`)).text();
    assert.ok(!room.includes(SECRET));
  } finally { await a.close(); }
});

test('ai proxy: unavailable without config', async () => {
  const a = createApp({ log: () => {}, ai: { available: false } });
  await a.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${a.server.address().port}`;
  try {
    const c = await (await fetch(base + '/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ member: { name: 'x', tzOffset: 0 } }) })).json();
    const r = await fetch(base + '/api/ai/messages', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${c.token}` }, body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }) });
    assert.equal(r.status, 503);
  } finally { await a.close(); }
});
