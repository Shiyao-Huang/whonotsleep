// WhoNotSleep — pure-JS 8-bit renderer with per-pixel lighting.
// renderScene(derived,{layout,t,focusId}) -> {width,height,data:Uint8ClampedArray RGBA}
// Plain ESM, zero deps, Hermes-safe.
import { TOOLS } from './protocol.js';
import { P, PAL, quantize } from './render/palette.js';
import { createCanvas, clearCanvas, outline } from './render/canvas.js';
import { timeOfDay, addLight, addShaft, addFloorPatch, compose, rgbOf, rimLight } from './render/lighting.js';
import { makePlan, drawShell, drawFairyLights, drawHangingPlant, drawFloorClutter } from './render/room.js';
import {
  drawDeskCounter, drawMonitor, drawAISprite, drawKeyboard, drawMug, drawLamp, drawChairBack,
} from './render/furniture.js';
import { drawBunk, drawFutonBase, drawEmptyBed, drawNightlight, sleeperHeadTop } from './render/beds.js';
import { drawSleeper } from './render/sleepers.js';
import { drawCharacter, avatarColors, avatarPalette } from './render/characters.js';
import { drawCaught, drawQuestion, drawEmote, drawSay, drawZzz, drawSteam, drawDust, drawCat, drawNameTag } from './render/fx.js';
import { renderAvatar } from './render/portrait.js';

export const LAYOUTS = { room: { w: 192, h: 120 }, wide: { w: 192, h: 88 }, small: { w: 96, h: 96 } };
export { avatarPalette, renderAvatar };

const AT_DESK = { typing: 1, sitting: 1 };
const CHAIR_COLS = [[P.v1, P.v2, P.v0], [P.t1, P.t2, P.t0], [P.r1, P.r2, P.r0], [P.ink3, P.ink4, P.ink2], [P.b1, P.b2, P.ink2], [P.w2, P.w3, P.w1]];
const CANVAS = {};

function seedOf(s) {
  let h = 2166136261;
  s = String(s || 'wns');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 997;
}

/** Assign members to desks and bed slots for a layout. Shared by renderScene + memberAnchors. */
function assign(derived, layout, focusId) {
  const members = (derived?.members || []).slice().sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0));
  const n = members.length;
  const plan = makePlan(layout === 'small' ? 'room' : layout, n, n);
  const entries = [];
  let bed = 0;
  members.forEach((m, i) => {
    const e = { m, i, seat: plan.seats[i] || null, bed: null, idx: (derived.members || []).indexOf(m) };
    if (m.pose === 'sleeping' && bed < plan.beds.length) e.bed = plan.beds[bed++];
    entries.push(e);
  });
  return { plan, entries, members };
}

function headTop(plan, e, t) {
  const m = e.m;
  if (e.bed) {
    return sleeperHeadTop(e.bed);
  }
  if (e.seat) {
    const bob = t != null && m.pose === 'typing' ? Math.floor(t / 520 + e.i) % 2 : 0; // matches drawCharacter head bob
    if (AT_DESK[m.pose]) return { x: e.seat.charX + 6, y: plan.deskY - 17 + bob };
    return { x: e.seat.charX + 6, y: plan.deskY - 17 };
  }
  return { x: plan.W >> 1, y: plan.floorY };
}

/** small layout = a 96x96 window cut from the room, centred on the focus member (desk or bed) */
function smallView(plan, entries, focusId) {
  const e = entries.find((q) => q.m.id === focusId) || entries[0];
  if (!e) return { x: 48, y: 24, fx: 96, fy: 70, e: null };
  const h = headTop(plan, e, null);
  const fy = e.bed ? h.y + 4 : h.y + 8;
  const x = Math.max(0, Math.min(192 - 96, Math.round(h.x - 48)));
  const y = Math.max(0, Math.min(120 - 96, Math.round(fy - 50)));
  return { x, y, fx: h.x, fy, e };
}

/** head-top anchors in base pixels for RN text overlays (small: only members inside the crop) */
export function memberAnchors(derived, layout = 'room', focusId = null) {
  if (!LAYOUTS[layout]) layout = 'room';
  const { plan, entries } = assign(derived || {}, layout, focusId);
  const out = entries.map((e) => { const h = headTop(plan, e, null); return { id: e.m.id, x: h.x, y: h.y }; });
  if (layout !== 'small') return out;
  const v = smallView(plan, entries, focusId);
  return out.map((a) => ({ id: a.id, x: a.x - v.x, y: a.y - v.y })).filter((a) => a.x >= -4 && a.x < 100 && a.y >= -4 && a.y < 100);
}

function toolRGB(tool) { return (TOOLS[tool] || TOOLS.other).color; }

/** animation clock: finite, non-negative, wrapped so huge epoch-ms values keep float precision */
export function safeT(t) {
  t = +t;
  if (!(t === t) || t === Infinity || t === -Infinity) return 0;
  const M = 1e9;
  return ((t % M) + M) % M;
}

/** never throws: on any internal failure returns a dark frame of the right size */
export function renderScene(derived, opts) {
  opts = opts || {};
  const layout = LAYOUTS[opts.layout] ? opts.layout : 'room';
  try {
    return renderSceneInner(derived && typeof derived === 'object' ? derived : {}, opts, layout);
  } catch (e) {
    const { w, h } = LAYOUTS[layout], data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) { data[i * 4] = 12; data[i * 4 + 1] = 10; data[i * 4 + 2] = 28; data[i * 4 + 3] = 255; }
    return { width: w, height: h, data };
  }
}

function renderSceneInner(derived, opts, layout) {
  const t = safeT(opts.t);
  if (layout !== 'small') {
    const c = renderFull(derived, layout, t, null);
    return { width: c.w, height: c.h, data: new Uint8ClampedArray(c.rgba) };
  }
  const c = renderFull(derived, 'small', t, opts.focusId || null);
  const v = c.view, S = 96, out = new Uint8ClampedArray(S * S * 4);
  for (let y = 0; y < S; y++) out.set(c.rgba.subarray(((y + v.y) * c.w + v.x) * 4, ((y + v.y) * c.w + v.x + S) * 4), y * S * 4);
  return { width: S, height: S, data: out };
}

function renderFull(derived, layout, t, focusId) {
  const small = layout === 'small';
  const key = small ? 'room' : layout;
  const { w: W, h: H } = LAYOUTS[key];
  const c = CANVAS[key] || (CANVAS[key] = createCanvas(W, H));
  clearCanvas(c, P.ink2);
  const { plan, entries } = assign(derived || {}, layout, focusId);
  const view = small ? smallView(plan, entries, focusId) : null;
  c.view = view;
  c.clipX0 = view ? view.x : undefined; c.clipX1 = view ? view.x + 96 : undefined;
  const tod = timeOfDay(derived?.roomHour ?? 22);
  const seed = seedOf(derived?.code);
  const night = tod.phase === 'night' || tod.phase === 'dusk' || tod.hour >= 18.5 || tod.hour < 6.5;

  // ---------------------------------------------------------------- albedo
  drawShell(c, plan, tod, t, seed);
  drawFairyLights(c, plan.fairy, t);
  if (plan.hang) drawHangingPlant(c, plan.hang[0], plan.hang[1], t);
  const bunkLights = drawBunk(c, plan, t, night);
  const nBeds = Math.min(plan.beds.length, Math.max(entries.length, 4));
  const occupied = new Set(entries.filter((e) => e.bed).map((e) => e.bed));
  // wide: futons sit under the desk line, so only lay them out when someone is actually asleep there
  const showBed = (s) => s.kind === 'bunk' || layout !== 'wide' || occupied.has(s);
  for (let b = 0; b < nBeds; b++) if (plan.beds[b].kind !== 'bunk' && showBed(plan.beds[b])) drawFutonBase(c, plan.beds[b]);
  for (let b = 0; b < nBeds; b++) {
    const s = plan.beds[b];
    if (occupied.has(s) || !showBed(s)) continue;
    drawEmptyBed(c, s);
  }
  for (const e of entries) {
    if (!e.bed) continue;
    drawSleeper(c, e.bed, e.m.avatar, { t, id: e.i + 1, n: e.i });
    outline(c, e.bed.x - 2, e.bed.y - 12, e.bed.x + 22, e.bed.y + 4, e.i + 1, P.ink1);
  }

  const seatInfo = [];
  plan.seats.forEach((s, si) => {
    const e = entries.find((q) => q.seat === s);
    const m = e?.m;
    const pose = m ? m.pose : 'gone';
    const at = AT_DESK[pose];
    const CH = CHAIR_COLS[(e ? e.i : si) % CHAIR_COLS.length];
    const q0 = { s, e, m, pose, at, mug: null };
    drawChairBack(c, s.charX, plan.deskY, CH[0], at ? 'sit' : pose === 'empty' ? 'pushed' : 'tucked', CH[1], CH[2]);
    if (at) {
      const ci = drawCharacter(c, m.avatar, s.charX, plan.deskY - 16, { pose, t, id: e.i + 1, seedN: e.i, look: -1, mood: m.badge === 'caught' ? 'caught' : 'normal' });
      outline(c, s.charX - 2, plan.deskY - 21, s.charX + 14, plan.deskY + 2, e.i + 1, P.ink1);
      q0.mug = ci.mug;
    }
    seatInfo.push(q0);
  });
  drawDeskCounter(c, plan);
  for (const q of seatInfo) {
    const { s, m, pose } = q;
    const state = pose === 'typing' ? 'ai' : pose === 'sitting' ? 'idle' : pose === 'empty' ? 'saver' : 'off';
    const rgb = m ? toolRGB(m.tool) : TOOLS.other.color;
    q.scr = drawMonitor(c, s, plan.deskY, state, rgb, t, q.e ? q.e.i : 0);
    q.state = state; q.rgb = rgb;
    if (state === 'ai') drawAISprite(c, q.scr, rgb, t, q.e.i);
    drawKeyboard(c, s.charX + 2, plan.deskY + 1, state === 'ai');
    if (m && (pose === 'typing' || pose === 'empty') && s.w >= 26) {
      const mugX = s.charX - 3;
      drawMug(c, mugX, plan.deskY + 1, avatarColors(m.avatar).shirt);
      drawSteam(c, mugX + 1, plan.deskY - 3, t + s.x * 37, 0.22);
    } else if (q.mug) drawSteam(c, q.mug.x, q.mug.y, t + s.x * 37, 0.3);
    q.lampOn = !!q.at && night;
    if (s.w >= 26) q.lamp = drawLamp(c, s.x + s.w - 3, plan.deskY + 1, q.lampOn);
  }
  // paper-star nightlight by the beds (always lit at night, cozy glow on sleepers)
  const nl = plan.bunk ? null : { x: plan.beds[0].x + 33, y: plan.beds[0].y - 22 };
  const nlOn = night || entries.some((e) => e.bed);
  if (nl) drawNightlight(c, nl.x, nl.y, nlOn, t);
  if (plan.clutter && nBeds <= 4) drawFloorClutter(c, plan.clutter[0], plan.clutter[1]);
  if (tod.phase === 'night') drawCat(c, W, plan.catY, t + seed * 1000);

  // ---------------------------------------------------------------- lights
  const amb = tod.amb.slice();
  if (derived?.lightsOn) { amb[0] += 0.14; amb[1] += 0.12; amb[2] += 0.08; }
  const win = plan.win;
  const shaftRGB = tod.shaft, sk = tod.shaftK;
  addShaft(c, { x: win.x, y: win.y, w: win.w, h: win.h, bottom: H, slope: tod.slope, rgb: shaftRGB, k: sk * 0.7, mullions: [win.w >> 1], floorY: plan.floorY, haze: 0.055 });
  drawDust(c, win, tod.slope, H, shaftRGB, 0.5, t);
  if (plan.patch !== false) {
    const py0 = plan.deskY + 18;
    if (py0 < H - 4) addFloorPatch(c, { x: win.x + tod.slope * (py0 - win.y) * 0.5 - 4, w: win.w, y0: py0, y1: H, slope: tod.slope, rgb: shaftRGB, k: sk * 0.9 });
  }
  // sky glow spilling onto the wall around the window
  addLight(c, { x: win.x + win.w / 2, y: win.y + win.h / 2, r: win.w * 0.95, rgb: shaftRGB, k: 0.22 * sk, floorSquash: 1 });
  // fairy lights: warm string glow along the top
  const [fx0, fy, fx1] = plan.fairy;
  for (let x = fx0 + 10; x < fx1; x += 28) addLight(c, { x, y: fy + 4, r: 18, rgb: [1.0, 0.72, 0.5], k: night ? 0.22 : 0.08, floorSquash: 1 });
  if (tod.moon > 0.2) {
    addLight(c, { x: win.x + win.w * 0.5, y: win.y + win.h + 2, r: 40, rgb: [0.5, 0.6, 1.0], k: 0.12 * tod.moon });
    // broad cool moon fill so empty desks read as shapes instead of a black band
    addLight(c, { x: win.x + win.w * 0.7, y: plan.deskY - 6, r: 90, rgb: [0.42, 0.5, 0.95], k: 0.13 * tod.moon, floorSquash: 1.3 });
  }
  for (const q of seatInfo) {
    const sc = q.scr;
    const cx = sc.x + sc.w / 2, cy = sc.y + sc.h / 2;
    if (q.state === 'ai') {
      const flick = 0.92 + 0.08 * Math.sin(t / 90 + q.s.x);
      const col = [q.rgb[0] / 255, q.rgb[1] / 255, q.rgb[2] / 255];
      addLight(c, { x: cx, y: cy, r: 40, rgb: col, k: (night ? 1.35 : 0.45) * flick, dir: [0.25, 1], cos: -0.35, soft: 0.5, charK: 1.25, blockY: plan.deskY + 2 });
      addLight(c, { x: cx, y: cy, r: 12, rgb: col, k: 0.35, floorSquash: 1 });
      if (q.at) rimLight(c, q.s.charX - 1, plan.deskY - 20, q.s.charX + 13, plan.deskY + 1, q.e.i + 1, -1, col, night ? 0.9 : 0.4);
    } else if (q.state === 'idle') {
      addLight(c, { x: cx, y: cy, r: 30, rgb: [0.75, 0.8, 1.0], k: night ? 0.8 : 0.25, dir: [0.2, 1], cos: -0.35, soft: 0.5, blockY: plan.deskY + 2 });
      if (q.at) rimLight(c, q.s.charX - 1, plan.deskY - 20, q.s.charX + 13, plan.deskY + 1, q.e.i + 1, -1, [0.7, 0.75, 1.0], night ? 0.6 : 0.25);
    } else if (q.state === 'saver') {
      addLight(c, { x: cx, y: cy, r: 18, rgb: rgbOf(P.v3), k: night ? 0.35 : 0.12, dir: [0, 1], cos: -0.3, blockY: plan.deskY + 2 });
    }
    if (q.lamp && q.lampOn) addLight(c, { x: q.lamp.x, y: q.lamp.y, r: 30, rgb: [1.0, 0.75, 0.45], k: 0.9, dir: [0, 1], cos: 0.0, soft: 0.6, blockY: plan.deskY + 2 });
  }
  if (nl && nlOn) addLight(c, { x: nl.x + 1.5, y: nl.y + 2, r: 30, rgb: [1.0, 0.68, 0.42], k: 0.9 * (0.93 + 0.07 * Math.sin(t / 1300)), floorSquash: 1.6 });
  for (const L of bunkLights) addLight(c, { ...L, floorSquash: 1.4 });
  // futon sleepers on the floor get a soft warm pool so they never sink into the vignette
  for (const e of entries) if (e.bed && e.bed.kind === 'futon') addLight(c, { x: e.bed.x + 10, y: e.bed.y - 10, r: 22, rgb: [1.0, 0.7, 0.48], k: night ? 0.75 : 0.3, floorSquash: 1.2 });
  // empty futons catch a faint lavender fill so their quilts read as colour, not a navy slab
  for (let b = 0; b < nBeds; b++) {
    const s = plan.beds[b];
    if (s.kind === 'futon' && !occupied.has(s) && showBed(s)) addLight(c, { x: s.x + 12, y: s.y - 6, r: 18, rgb: [0.75, 0.68, 1.0], k: night ? 0.5 : 0.15, floorSquash: 1.2 });
  }
  if (derived?.lightsOn) addLight(c, { x: W * 0.6, y: -10, r: W * 0.9, rgb: [1.0, 0.92, 0.78], k: 0.35, floorSquash: 1 });
  // caught: the "!" throws a pulsing red alarm glow onto the wall around the night owl
  for (const e of entries) {
    if (e.m.badge !== 'caught') continue;
    const h = headTop(plan, e, t);
    addLight(c, { x: h.x, y: h.y - 10, r: 22, rgb: [1.0, 0.25, 0.22], k: 0.45 + 0.25 * Math.abs(Math.sin(t / 170)), floorSquash: 1 });
  }

  // -------------------------------------------------------------- overlays
  // order: Zzz < speech < badges < emotes, so short emotes are never hidden by a long line of text
  const sayW = Math.max(44, Math.min(80, (plan.seats[0]?.w || 30) * 2 + 8));
  const heads = entries.map((e) => headTop(plan, e, t));
  entries.forEach((e, n) => { if (e.bed) drawZzz(c, heads[n].x + 8, heads[n].y + 2, t, e.i * 0.37); });
  entries.forEach((e, n) => {
    if (!e.m.activeSay) return;
    const lift = (e.m.badge ? 12 : 0) + (e.m.activeEmote && !e.m.badge ? 12 : 0);
    drawSay(c, e.m.activeSay.text, heads[n].x, heads[n].y - lift, t, sayW);
  });
  entries.forEach((e, n) => {
    const h = heads[n];
    if (e.m.badge === 'caught') drawCaught(c, h.x, h.y, t);
    else if (e.m.badge === 'question') drawQuestion(c, h.x + 1, h.y, t, e.i);
  });
  entries.forEach((e, n) => {
    const h = heads[n], em = e.m.activeEmote;
    if (!em) return;
    if (e.m.badge) drawEmote(c, em.kind, h.x + 5, h.y + 9, t, e.i); // badge owns the top: emote pops out beside the head
    else drawEmote(c, em.kind, h.x, h.y, t, e.i);
  });
  for (const q of seatInfo) {
    if (!q.m) continue;
    drawNameTag(c, q.m.name, q.s.x + q.s.w / 2, plan.deskY + 6, q.s.w - 4, !q.m.online, avatarColors(q.m.avatar).shirt, !!view && view.e === q.e);
  }

  // ------------------------------------------------------------ composite
  if (view) spotlight(c, view);
  compose(c, amb, 0.85, night ? [0.16, 0.15, 0.2] : [0.05, 0.05, 0.05]);
  quantize(W, H, c.col, c.spread, 20, c.qidx, c.rgba);
  const rgba = c.rgba, over = c.over;
  for (let i = 0; i < c.n; i++) {
    const k = over[i];
    if (k < 0) continue;
    rgba[i * 4] = PAL[k * 3]; rgba[i * 4 + 1] = PAL[k * 3 + 1]; rgba[i * 4 + 2] = PAL[k * 3 + 2];
  }
  return c;
}

/** small layout: gently darken everything away from the focus member (counteracts the off-centre room vignette) */
function spotlight(c, v) {
  const W = c.w;
  for (let y = v.y; y < v.y + 96; y++) for (let x = v.x; x < v.x + 96; x++) {
    const dx = (x - v.fx) / 58, dy = (y - v.fy) / 50, d = dx * dx + dy * dy;
    if (d < 0.35) continue;
    const f = d > 1.4 ? 0.62 : 1 - 0.38 * (d - 0.35) / 1.05;
    const i = y * W + x;
    c.occ[i] = c.occ[i] * f;
  }
}
