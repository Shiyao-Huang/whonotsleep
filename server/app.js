// WhoNotSleep server core. createApp(opts) -> { server, listen(), close(), store }
// Node 20 ESM, only dependency: ws.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { WebSocketServer } from 'ws';
import {
  STATUSES, TOOLS, EMOTES, OFFLINE_AFTER_MS, MAX_MEMBERS, AVATAR_COUNTS,
  deriveScene, avatarFromSeed,
} from '../shared/protocol.js';
import { loadAiConfig, buildUpstreamBody, callUpstream } from './ai.js';

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I L O 0 1
const ROOM_CODE_LEN = 5;
const LINK_CODE_LEN = 6;
const LINK_CODE_TTL_MS = 10 * 60_000;
const MAX_EVENTS = 50;
const BODY_LIMIT = 16 * 1024;
const AI_BODY_LIMIT = 192 * 1024;
const AI_DAILY_CAP = 400; // upstream calls per member per UTC day
const SCENE_BUCKET_MS = 10_000;
const SCENE_CACHE_MAX = 200;
const LAYOUT_NAMES = ['room', 'wide', 'small'];

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => new HttpError(400, msg);

function randomCode(len) {
  const bytes = crypto.randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return s;
}
const charLen = (s) => [...s].length;

function cleanName(v, max = 24) {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!s || charLen(s) > max) return null;
  return s;
}

function cleanAvatar(v, seed, current = null) {
  const base = current && typeof current === 'object' ? { ...avatarFromSeed(seed || 'wns'), ...current } : avatarFromSeed(seed || 'wns');
  if (v == null) return base;
  if (typeof v !== 'object' || Array.isArray(v)) throw bad('avatar must be an object');
  const out = {};
  for (const k of Object.keys(AVATAR_COUNTS)) {
    const n = v[k];
    if (n == null) { out[k] = base[k]; continue; }
    if (!Number.isInteger(n) || n < 0 || n >= AVATAR_COUNTS[k]) throw bad(`avatar.${k} out of range`);
    out[k] = n;
  }
  return out;
}

function cleanTz(v, fallback = 0) {
  if (v == null) return fallback;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < -840 || v > 840) throw bad('tzOffset must be minutes in [-840, 840]');
  return Math.round(v);
}

function toolLabel(tool) { return (TOOLS[tool] || TOOLS.other).label; }

/** Public snapshot of a member: never includes token or internal fields. */
function memberSnapshot(m) {
  return {
    id: m.id, name: m.name, avatar: m.avatar, seat: m.seat,
    status: m.status, tool: m.tool, detail: m.detail, tzOffset: m.tzOffset,
    lastSeen: m.lastSeen, statusSince: m.statusSince, goodnightAt: m.goodnightAt,
    emote: m.emote, say: m.say, hasComputer: m.hasComputer,
  };
}
function roomSnapshot(r) {
  return {
    code: r.code, name: r.name, createdAt: r.createdAt,
    members: [...r.members].sort((a, b) => a.seat - b.seat).map(memberSnapshot),
    events: r.events.slice(-MAX_EVENTS),
  };
}

// ------------------------------------------------------------------ store
class Store {
  constructor({ dataFile, saveDebounceMs = 1000, now = Date.now }) {
    this.dataFile = dataFile;
    this.saveDebounceMs = saveDebounceMs;
    this.now = now;
    this.rooms = new Map();     // code -> room (internal, members carry token)
    this.tokens = new Map();    // token -> { code, memberId }
    this.linkCodes = new Map(); // linkCode -> { code, memberId, expiresAt }
    this.saveTimer = null;
    this.load();
  }

  load() {
    if (!this.dataFile) return;
    try {
      const raw = JSON.parse(fs.readFileSync(this.dataFile, 'utf8'));
      for (const r of raw.rooms || []) {
        r.version = r.version || 1;
        r.events = Array.isArray(r.events) ? r.events : [];
        r.members = Array.isArray(r.members) ? r.members : [];
        this.rooms.set(r.code, r);
        for (const m of r.members) if (m.token) this.tokens.set(m.token, { code: r.code, memberId: m.id });
      }
    } catch (e) {
      if (e.code !== 'ENOENT') {
        console.error('[wns] failed to load', this.dataFile, e.message);
        // keep the unreadable file instead of overwriting it with an empty store on next save
        try { fs.renameSync(this.dataFile, `${this.dataFile}.corrupt-${Date.now()}`); } catch { /* ignore */ }
      }
    }
  }

  scheduleSave() {
    if (!this.dataFile || this.saveTimer) return;
    this.saveTimer = setTimeout(() => { this.saveTimer = null; this.saveNow(); }, this.saveDebounceMs);
    this.saveTimer.unref?.();
  }

  saveNow() {
    if (!this.dataFile) return;
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    try {
      fs.mkdirSync(path.dirname(this.dataFile), { recursive: true });
      const tmp = this.dataFile + '.tmp';
      // file holds member tokens: keep it private
      fs.writeFileSync(tmp, JSON.stringify({ savedAt: this.now(), rooms: [...this.rooms.values()] }), { mode: 0o600 });
      fs.renameSync(tmp, this.dataFile);
    } catch (e) {
      console.error('[wns] save failed', e.message);
    }
  }

  newRoomCode() {
    for (let i = 0; i < 1000; i++) {
      const c = randomCode(ROOM_CODE_LEN);
      if (!this.rooms.has(c)) return c;
    }
    throw new HttpError(500, 'could not allocate room code');
  }

  newMember(room, { name, avatar, tzOffset }) {
    const used = new Set(room.members.map((m) => m.seat));
    let seat = 0;
    while (used.has(seat)) seat++;
    const now = this.now();
    const m = {
      id: crypto.randomBytes(6).toString('hex'),
      token: crypto.randomBytes(32).toString('hex'),
      name, avatar, seat,
      status: 'idle', tool: null, detail: null, tzOffset,
      lastSeen: now, statusSince: now, goodnightAt: null,
      emote: null, say: null, hasComputer: false,
      owlFlag: false,
    };
    room.members.push(m);
    this.tokens.set(m.token, { code: room.code, memberId: m.id });
    return m;
  }

  addEvent(room, memberId, kind, text) {
    room.events.push({ at: this.now(), memberId, kind, text });
    if (room.events.length > MAX_EVENTS) room.events.splice(0, room.events.length - MAX_EVENTS);
  }

  auth(token) {
    const ref = token && this.tokens.get(token);
    if (!ref) return null;
    const room = this.rooms.get(ref.code);
    const member = room?.members.find((m) => m.id === ref.memberId);
    if (!member) { this.tokens.delete(token); return null; }
    return { room, member };
  }

  removeMember(room, member) {
    room.members = room.members.filter((m) => m !== member);
    this.tokens.delete(member.token);
    for (const [c, l] of this.linkCodes) if (l.memberId === member.id) this.linkCodes.delete(c);
  }

  /** Apply time-based state transitions (heartbeat timeout, night owl detection). Returns true if changed. */
  sweep(room) {
    const now = this.now();
    let changed = false;
    for (const m of room.members) {
      if (m.status !== 'offline' && now - (m.lastSeen || 0) >= OFFLINE_AFTER_MS) {
        if (m.status === 'working') this.addEvent(room, m.id, 'stopped', `停下了 ${toolLabel(m.tool)}`);
        m.status = 'offline';
        m.tool = null;
        m.statusSince = (m.lastSeen || 0) + OFFLINE_AFTER_MS;
        changed = true;
      }
    }
    const derived = deriveScene(roomSnapshot(room), now);
    for (const d of derived.members) {
      const m = room.members.find((x) => x.id === d.id);
      if (!m) continue;
      if (d.nightOwl && !m.owlFlag) {
        m.owlFlag = true;
        this.addEvent(room, m.id, 'caught-night-owl', `说了晚安却还在用 ${toolLabel(m.tool)},被抓到了!`);
        changed = true;
      } else if (!d.nightOwl && m.owlFlag) {
        m.owlFlag = false; // internal only; no broadcast needed
        this.scheduleSave();
      }
    }
    return changed;
  }

  pruneLinkCodes() {
    const now = this.now();
    for (const [c, l] of this.linkCodes) if (l.expiresAt <= now) this.linkCodes.delete(c);
  }
}

// ------------------------------------------------------------- rate limit
class RateLimiter {
  constructor({ perMinute, burst }) {
    this.rate = perMinute / 60_000;
    this.burst = burst;
    this.buckets = new Map();
  }
  take(key, now = Date.now()) {
    let b = this.buckets.get(key);
    if (!b) { b = { tokens: this.burst, at: now }; this.buckets.set(key, b); }
    b.tokens = Math.min(this.burst, b.tokens + Math.max(0, now - b.at) * this.rate);
    b.at = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }
  prune(now = Date.now()) {
    for (const [k, b] of this.buckets) if (now - b.at > 10 * 60_000) this.buckets.delete(k);
  }
}

// -------------------------------------------------------------- renderer
async function defaultLoadRenderer() {
  const [scene, png] = await Promise.all([import('../shared/scene.js'), import('../shared/png.js')]);
  return { renderScene: scene.renderScene, encodePNG: png.encodePNG };
}

// ------------------------------------------------------------------- app
export function createApp(opts = {}) {
  const {
    dataFile = null,
    saveDebounceMs = 1000,
    tickMs = 30_000,
    now = Date.now,
    rateLimit = { perMinute: 240, burst: 120 },
    linkRateLimit = { perMinute: 10, burst: 10 },
    trustProxy = true,
    loadRenderer = defaultLoadRenderer,
    ai = loadAiConfig(),
    aiFetch = (...a) => fetch(...a),
    aiRateLimit = { perMinute: 20, burst: 10 },
    log = (...a) => console.log('[wns]', ...a),
  } = opts;

  const store = new Store({ dataFile, saveDebounceMs, now });
  const limiter = new RateLimiter(rateLimit);
  const linkLimiter = new RateLimiter(linkRateLimit);
  const aiLimiter = new RateLimiter(aiRateLimit);
  const aiDaily = new Map(); // memberId -> {day, n}
  const sockets = new Map(); // code -> Set<ws>
  const sceneCache = new Map();
  let rendererPromise = null;

  function getRenderer() {
    if (!rendererPromise) {
      rendererPromise = Promise.resolve().then(loadRenderer).catch((e) => {
        rendererPromise = null; // retry on next request
        throw e;
      });
    }
    return rendererPromise;
  }

  function broadcast(room) {
    const set = sockets.get(room.code);
    if (!set || !set.size) return;
    const msg = JSON.stringify({ type: 'room', room: roomSnapshot(room), now: now() });
    for (const ws of set) if (ws.readyState === 1) ws.send(msg);
  }

  /** Call after any mutation. */
  function changed(room) {
    room.version = (room.version || 0) + 1;
    store.sweep(room);
    store.scheduleSave();
    broadcast(room);
  }

  function tick() {
    store.pruneLinkCodes();
    limiter.prune(); linkLimiter.prune();
    for (const room of store.rooms.values()) {
      if (store.sweep(room)) { room.version++; store.scheduleSave(); }
      broadcast(room);
    }
    for (const set of sockets.values()) {
      for (const ws of set) {
        if (ws.isAlive === false) { ws.terminate(); continue; }
        ws.isAlive = false;
        try { ws.ping(); } catch { /* ignore */ }
      }
    }
    const bucket = Math.floor(now() / SCENE_BUCKET_MS);
    for (const [k, v] of sceneCache) if (v.bucket < bucket - 1) sceneCache.delete(k);
  }

  function clientIp(req) {
    const remote = req.socket.remoteAddress || '';
    const loopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
    if (trustProxy && loopback && req.headers['x-forwarded-for']) {
      // rightmost entry = the address our own proxy (Caddy) saw; leftmost entries are client-controlled
      const parts = String(req.headers['x-forwarded-for']).split(',').map((x) => x.trim()).filter(Boolean);
      if (parts.length) return parts[parts.length - 1];
    }
    return remote;
  }

  function readBody(req, limit = BODY_LIMIT) {
    const BODY_LIMIT = limit;
    return new Promise((resolve, reject) => {
      const len = Number(req.headers['content-length'] || 0);
      if (len > BODY_LIMIT) { reject(new HttpError(413, 'body too large')); req.resume(); return; }
      const chunks = [];
      let size = 0;
      let failed = false;
      req.on('data', (c) => {
        if (failed) return;
        size += c.length;
        if (size > BODY_LIMIT) { failed = true; reject(new HttpError(413, 'body too large')); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        if (failed) return;
        const text = Buffer.concat(chunks).toString('utf8').trim();
        if (!text) return resolve({});
        try {
          const v = JSON.parse(text);
          if (!v || typeof v !== 'object' || Array.isArray(v)) return reject(bad('body must be a JSON object'));
          resolve(v);
        } catch { reject(bad('invalid JSON')); }
      });
      req.on('error', reject);
    });
  }

  function requireAuth(req) {
    const h = req.headers.authorization || '';
    const m = /^Bearer\s+(\S+)$/i.exec(h);
    const a = m && store.auth(m[1]);
    if (!a) throw new HttpError(401, 'invalid or missing token');
    return a;
  }

  function getRoom(code) {
    const room = store.rooms.get(String(code || '').toUpperCase());
    if (!room) throw new HttpError(404, 'room not found');
    return room;
  }

  function parseMember(v) {
    if (!v || typeof v !== 'object') throw bad('member required');
    const name = cleanName(v.name);
    if (!name) throw bad('member.name must be 1-24 chars');
    return { name, avatar: cleanAvatar(v.avatar, name), tzOffset: cleanTz(v.tzOffset, 0) };
  }

  const ok = { ok: true };

  // ---- handlers
  const routes = [
    ['GET', /^\/healthz$/, async () => ({ text: 'ok' })],

    ['GET', /^\/api\/ai\/status$/, async () => ({ json: { available: ai.available, model: ai.available ? ai.model : null } })],

    ['POST', /^\/api\/ai\/messages$/, async (req) => {
      const { member } = requireAuth(req);
      if (!ai.available) throw new HttpError(503, 'ai_unavailable');
      const body = await readBody(req, AI_BODY_LIMIT);
      let upstream;
      try { upstream = buildUpstreamBody(body, ai.model); } catch (e) { throw bad(e.message); }
      if (!aiLimiter.take(member.id, now())) throw new HttpError(429, 'ai_rate_limited');
      const day = Math.floor(now() / 86_400_000);
      const d = aiDaily.get(member.id);
      if (d && d.day === day && d.n >= AI_DAILY_CAP) throw new HttpError(429, 'ai_rate_limited');
      aiDaily.set(member.id, d && d.day === day ? { day, n: d.n + 1 } : { day, n: 1 });
      try {
        return { json: await callUpstream(ai, upstream, aiFetch) };
      } catch (e) {
        log('ai upstream error', e.status || '', String(e.message).slice(0, 80));
        throw new HttpError(e.status || 502, e.publicMessage || 'ai_upstream_error');
      }
    }],

    ['POST', /^\/api\/rooms$/, async (req) => {
      const body = await readBody(req);
      const member = parseMember(body.member);
      let name = body.name == null || body.name === '' ? `${member.name}的房间` : cleanName(body.name, 32);
      if (!name) throw bad('name must be 1-32 chars');
      const room = { code: store.newRoomCode(), name, createdAt: now(), members: [], events: [], version: 1 };
      store.rooms.set(room.code, room);
      const m = store.newMember(room, member);
      store.addEvent(room, m.id, 'joined', '创建了房间');
      changed(room);
      return { status: 201, json: { room: roomSnapshot(room), memberId: m.id, token: m.token } };
    }],

    ['POST', /^\/api\/rooms\/([A-Za-z0-9]+)\/join$/, async (req, [code]) => {
      const body = await readBody(req);
      const room = getRoom(code);
      const member = parseMember(body.member);
      if (room.members.length >= MAX_MEMBERS) throw new HttpError(409, 'room is full');
      const m = store.newMember(room, member);
      store.addEvent(room, m.id, 'joined', '加入了房间');
      changed(room);
      return { json: { room: roomSnapshot(room), memberId: m.id, token: m.token } };
    }],

    ['GET', /^\/api\/rooms\/([A-Za-z0-9]+)$/, async (req, [code]) => {
      const room = getRoom(code);
      if (store.sweep(room)) changed(room);
      return { json: { room: roomSnapshot(room) } };
    }],

    ['GET', /^\/api\/rooms\/([A-Za-z0-9]+)\/scene\.png$/, async (req, [code], url) => {
      const room = getRoom(code);
      if (store.sweep(room)) changed(room);
      const q = url.searchParams;
      const layout = q.get('layout') || 'room';
      if (!LAYOUT_NAMES.includes(layout)) throw bad('layout must be room|wide|small');
      let scale = parseInt(q.get('scale') || '4', 10);
      if (!Number.isFinite(scale)) scale = 4;
      scale = Math.max(1, Math.min(6, scale));
      const focusRaw = q.get('focus');
      const focusId = focusRaw && room.members.some((m) => m.id === focusRaw) ? focusRaw : null;
      const tNow = now();
      const bucket = Math.floor(tNow / SCENE_BUCKET_MS);
      const tParam = q.get('t');
      const tExplicit = tParam != null && /^-?\d+$/.test(tParam);
      const t = tExplicit ? Number(tParam) : bucket * SCENE_BUCKET_MS;
      const key = `${room.code}|${room.version}|${layout}|${scale}|${focusId || ''}|${bucket}|${tExplicit ? t : ''}`;
      let png = sceneCache.get(key)?.png;
      if (!png) {
        let r;
        try { r = await getRenderer(); } catch (e) {
          log('renderer unavailable:', e.message);
          throw new HttpError(503, 'renderer unavailable');
        }
        const derived = deriveScene(roomSnapshot(room), tNow);
        const img = r.renderScene(derived, { layout, t, focusId });
        const bytes = r.encodePNG(img.width, img.height, img.data, { scale, deflate: (u8) => zlib.deflateSync(u8) });
        png = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        sceneCache.set(key, { png, bucket });
        if (sceneCache.size > SCENE_CACHE_MAX) sceneCache.delete(sceneCache.keys().next().value);
      }
      return {
        body: png,
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=10' },
      };
    }],

    ['POST', /^\/api\/me\/linkcode$/, async (req) => {
      const { room, member } = requireAuth(req);
      for (const [c, l] of store.linkCodes) if (l.memberId === member.id) store.linkCodes.delete(c);
      let linkCode;
      do { linkCode = randomCode(LINK_CODE_LEN); } while (store.linkCodes.has(linkCode));
      const expiresAt = now() + LINK_CODE_TTL_MS;
      store.linkCodes.set(linkCode, { code: room.code, memberId: member.id, expiresAt });
      return { json: { linkCode, expiresAt } };
    }],

    ['POST', /^\/api\/link$/, async (req, _m, _u, ip) => {
      if (!linkLimiter.take(ip, now())) throw new HttpError(429, 'too many link attempts');
      const body = await readBody(req);
      if (typeof body.linkCode !== 'string' || !body.linkCode.trim()) throw bad('linkCode required');
      const lc = body.linkCode.trim().toUpperCase();
      const l = store.linkCodes.get(lc);
      if (!l || l.expiresAt <= now()) { store.linkCodes.delete(lc); throw new HttpError(404, 'link code invalid or expired'); }
      store.linkCodes.delete(lc); // single use
      const room = store.rooms.get(l.code);
      const member = room?.members.find((m) => m.id === l.memberId);
      if (!member) throw new HttpError(404, 'member no longer exists');
      member.hasComputer = true;
      changed(room);
      return { json: { token: member.token, memberId: member.id, roomCode: room.code, name: member.name } };
    }],

    ['POST', /^\/api\/me\/report$/, async (req) => {
      const body = await readBody(req);
      const { room, member } = requireAuth(req);
      if (!STATUSES.includes(body.status)) throw bad(`status must be one of ${STATUSES.join('|')}`);
      const status = body.status;
      let tool = null;
      if (status === 'working') {
        const t = typeof body.tool === 'string' ? body.tool.toLowerCase() : 'other';
        tool = TOOLS[t] ? t : 'other';
      }
      let detail = null;
      if (body.detail != null) {
        if (typeof body.detail !== 'string') throw bad('detail must be a string');
        detail = body.detail.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40) || null;
      }
      const tz = cleanTz(body.tzOffset, member.tzOffset);
      const prevStatus = member.status, prevTool = member.tool;
      const t = now();
      member.lastSeen = t;
      member.tzOffset = tz;
      if (status !== prevStatus || tool !== prevTool) {
        member.statusSince = t;
        if (prevStatus === 'working' && prevTool && (status !== 'working' || tool !== prevTool)) {
          store.addEvent(room, member.id, 'stopped', `停下了 ${toolLabel(prevTool)}`);
        }
        if (status === 'working') {
          store.addEvent(room, member.id, 'started', `开始用 ${toolLabel(tool)}${detail ? ` · ${detail}` : ''}`);
        }
      }
      member.status = status;
      member.tool = tool;
      member.detail = status === 'working' ? detail : null;
      changed(room);
      return { json: ok };
    }],

    ['POST', /^\/api\/me\/goodnight$/, async (req) => {
      const { room, member } = requireAuth(req);
      member.goodnightAt = now();
      store.addEvent(room, member.id, 'goodnight', '说了晚安');
      changed(room);
      return { json: ok };
    }],

    ['POST', /^\/api\/me\/morning$/, async (req) => {
      const { room, member } = requireAuth(req);
      member.goodnightAt = null;
      store.addEvent(room, member.id, 'morning', '说了早安');
      changed(room);
      return { json: ok };
    }],

    ['POST', /^\/api\/me\/emote$/, async (req) => {
      const body = await readBody(req);
      const { room, member } = requireAuth(req);
      if (!EMOTES.includes(body.kind)) throw bad(`kind must be one of ${EMOTES.join('|')}`);
      let target = member;
      if (body.to != null && body.to !== member.id) {
        target = room.members.find((m) => m.id === body.to);
        if (!target) throw bad('unknown target member');
      }
      target.emote = { kind: body.kind, at: now(), from: target === member ? null : member.id };
      store.addEvent(room, member.id, 'emote', target === member ? body.kind : `${body.kind} → ${target.name}`);
      changed(room);
      return { json: ok };
    }],

    ['POST', /^\/api\/me\/say$/, async (req) => {
      const body = await readBody(req);
      const { room, member } = requireAuth(req);
      if (typeof body.text !== 'string') throw bad('text required');
      const text = body.text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
      if (!text || charLen(text) > 80) throw bad('text must be 1-80 chars');
      member.say = { text, at: now() };
      store.addEvent(room, member.id, 'say', text);
      changed(room);
      return { json: ok };
    }],

    ['PATCH', /^\/api\/me$/, async (req) => {
      const body = await readBody(req);
      const { room, member } = requireAuth(req);
      let name = member.name, avatar = member.avatar;
      if (body.name != null) { name = cleanName(body.name); if (!name) throw bad('name must be 1-24 chars'); }
      if (body.avatar != null) avatar = cleanAvatar(body.avatar, name, member.avatar);
      member.name = name; member.avatar = avatar;
      changed(room);
      return { json: ok };
    }],

    ['DELETE', /^\/api\/me$/, async (req) => {
      const { room, member } = requireAuth(req);
      store.removeMember(room, member);
      store.addEvent(room, member.id, 'left', '离开了房间');
      if (!room.members.length) {
        store.rooms.delete(room.code);
        const set = sockets.get(room.code);
        if (set) for (const ws of set) ws.close(4404, 'room closed');
        sockets.delete(room.code);
        store.scheduleSave();
      } else {
        changed(room);
      }
      // close the leaver's sockets
      for (const ws of sockets.get(room.code) || []) if (ws.memberId === member.id) ws.close(4401, 'left room');
      return { json: ok };
    }],
  ];

  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
  };

  function send(res, status, body, headers = {}) {
    if (res.headersSent) return;
    res.writeHead(status, { ...CORS, ...headers });
    res.end(body);
  }
  const sendJson = (res, status, obj) => send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });

  async function handle(req, res) {
    let url;
    try { url = new URL(req.url, 'http://x'); } catch { return sendJson(res, 400, { error: 'bad url' }); }
    if (req.method === 'OPTIONS') return send(res, 204, '');
    const ip = clientIp(req);
    if (!limiter.take(ip, now())) return sendJson(res, 429, { error: 'rate limited' });
    let methodMismatch = false;
    for (const [method, re, fn] of routes) {
      const m = re.exec(url.pathname);
      if (!m) continue;
      if (method !== req.method && !(method === 'GET' && req.method === 'HEAD')) { methodMismatch = true; continue; }
      try {
        const out = await fn(req, m.slice(1), url, ip);
        if (out.text != null) return send(res, out.status || 200, out.text, { 'Content-Type': 'text/plain; charset=utf-8' });
        if (out.body != null) return send(res, out.status || 200, req.method === 'HEAD' ? '' : out.body, out.headers);
        return sendJson(res, out.status || 200, out.json);
      } catch (e) {
        if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message });
        log('error', req.method, url.pathname, e.stack || e);
        return sendJson(res, 500, { error: 'internal error' });
      }
    }
    return sendJson(res, methodMismatch ? 405 : 404, { error: methodMismatch ? 'method not allowed' : 'not found' });
  }

  const server = http.createServer((req, res) => { handle(req, res); });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });

  server.on('upgrade', (req, socket, head) => {
    const reject = (status, msg) => {
      socket.write(`HTTP/1.1 ${status} ${msg}\r\nConnection: close\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ error: msg })}`);
      socket.destroy();
    };
    let url;
    try { url = new URL(req.url, 'http://x'); } catch { return reject(400, 'Bad Request'); }
    if (url.pathname !== '/ws') return reject(404, 'Not Found');
    if (!limiter.take(clientIp(req), now())) return reject(429, 'Too Many Requests');
    const code = String(url.searchParams.get('room') || '').toUpperCase();
    const room = store.rooms.get(code);
    if (!room) return reject(404, 'Not Found');
    const a = store.auth(url.searchParams.get('token'));
    if (!a || a.room.code !== code) return reject(401, 'Unauthorized');
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.isAlive = true;
      ws.memberId = a.member.id;
      let set = sockets.get(code);
      if (!set) { set = new Set(); sockets.set(code, set); }
      set.add(ws);
      ws.on('pong', () => { ws.isAlive = true; });
      ws.on('message', (data) => {
        ws.isAlive = true;
        let msg;
        try { msg = JSON.parse(String(data)); } catch { return; }
        if (msg && msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong', now: now() }));
      });
      ws.on('close', () => { set.delete(ws); if (!set.size && sockets.get(code) === set) sockets.delete(code); });
      ws.on('error', () => {});
      const r = store.rooms.get(code);
      if (r) ws.send(JSON.stringify({ type: 'room', room: roomSnapshot(r), now: now() }));
    });
  });

  let tickTimer = null;
  return {
    server,
    store,
    tick,
    listen(port = 3420, host = '127.0.0.1') {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          tickTimer = setInterval(tick, tickMs);
          tickTimer.unref?.();
          resolve(server.address());
        });
      });
    },
    close() {
      return new Promise((resolve) => {
        if (tickTimer) clearInterval(tickTimer);
        for (const set of sockets.values()) for (const ws of set) ws.terminate();
        wss.close();
        store.saveNow();
        server.close(() => resolve());
        server.closeAllConnections?.();
      });
    },
  };
}

export { roomSnapshot, memberSnapshot };
