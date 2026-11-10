// WhoNotSleep — shared protocol + scene derivation.
// Plain ESM JavaScript (no deps) so it runs unchanged in Node 20 (server/CLI)
// and in Metro/Hermes (React Native app + Android widget headless task).

/** Public server. Override with WNS_SERVER (CLI/server) or app settings. */
export const DEFAULT_SERVER = 'https://wns.168-231-73-244.sslip.io';

/**
 * Member status as reported by the Mac CLI (`wns`) / app.
 * - offline : no heartbeat for > OFFLINE_AFTER_MS (computer off / daemon stopped)
 * - idle    : computer on, user present, no AI tool running
 * - working : an AI tool is running (claude, codex, gemini, ...) and user is active
 * - away    : computer on but user idle (HID idle > 5 min) — chair empty
 */
export const STATUSES = ['offline', 'idle', 'working', 'away'];

/** Known AI tools. `color` drives the monitor glow light; `label` shows on UI. */
export const TOOLS = {
  claude:   { label: 'Claude Code', color: [217, 119, 87] },   // warm coral
  codex:    { label: 'Codex',       color: [120, 230, 190] },  // mint
  gemini:   { label: 'Gemini',      color: [120, 150, 255] },  // blue-violet
  cursor:   { label: 'Cursor',      color: [200, 200, 215] },  // silver
  copilot:  { label: 'Copilot',     color: [170, 120, 255] },  // purple
  aider:    { label: 'Aider',       color: [110, 230, 110] },  // green
  opencode: { label: 'OpenCode',    color: [255, 200, 90] },   // amber
  goose:    { label: 'Goose',       color: [255, 255, 255] },
  amp:      { label: 'Amp',         color: [255, 90, 140] },   // pink
  chatgpt:  { label: 'ChatGPT',     color: [100, 210, 170] },
  other:    { label: 'AI',          color: [160, 220, 255] },
};

export const EMOTES = ['question', 'exclaim', 'zzz', 'heart', 'note', 'sweat', 'star', 'wave', 'angry', 'moon'];

export const OFFLINE_AFTER_MS = 90_000;     // heartbeat timeout
export const GOODNIGHT_TTL_MS = 14 * 3600_000; // a goodnight counts for 14h
export const EMOTE_TTL_MS = 6_000;           // transient emote bubble lifetime
export const SAY_TTL_MS = 9_000;             // speech bubble lifetime
export const MAX_MEMBERS = 6;

/**
 * Avatar: small set of palette indices; renderer maps them to colors.
 * @typedef {{ skin:number, hair:number, hairStyle:number, shirt:number, accessory:number }} Avatar
 *
 * Member as stored/sent by server.
 * @typedef {{
 *   id:string, name:string, avatar:Avatar, seat:number,
 *   status:'offline'|'idle'|'working'|'away',
 *   tool:string|null,          // key of TOOLS when working
 *   detail:string|null,        // optional short text e.g. repo name "whonotsleep"
 *   tzOffset:number,           // minutes east of UTC (e.g. +480 for Asia/Shanghai)
 *   lastSeen:number,           // ms epoch of last heartbeat (CLI) or app ping
 *   statusSince:number,        // ms epoch when status/tool last changed
 *   goodnightAt:number|null,   // ms epoch when member said goodnight
 *   emote:{kind:string, at:number, from:string|null}|null,
 *   say:{text:string, at:number}|null,
 *   hasComputer:boolean,       // a CLI has ever linked for this member
 * }} Member
 *
 * Room snapshot.
 * @typedef {{
 *   code:string, name:string, createdAt:number,
 *   members:Member[],
 *   events:{at:number, memberId:string, kind:string, text:string}[], // newest last, max 50
 * }} Room
 */

// ---------------------------------------------------------------- REST/WS API
// All bodies JSON. Auth = `Authorization: Bearer <token>` (member token).
//
// POST /api/rooms                      {name, member:{name, avatar, tzOffset}} -> {room, memberId, token}
// POST /api/rooms/:code/join           {member:{name, avatar, tzOffset}}       -> {room, memberId, token}
// GET  /api/rooms/:code                                                       -> {room}
// GET  /api/rooms/:code/scene.png?layout=room|small|wide&scale=1..6&t=<ms>   -> image/png (rendered by shared/scene.js)
// POST /api/me/linkcode   (auth)                                              -> {linkCode, expiresAt}   (6 chars, 10 min)
// POST /api/link          {linkCode}                                          -> {token, memberId, roomCode, name}
// POST /api/me/report     (auth) {status, tool, detail, tzOffset}             -> {ok}   (CLI heartbeat, every ~20s + on change)
// POST /api/me/goodnight  (auth)                                              -> {ok}
// POST /api/me/morning    (auth)  (clears goodnight)                          -> {ok}
// POST /api/me/emote      (auth) {kind, to?:memberId}                         -> {ok}
// POST /api/me/say        (auth) {text}  (<= 80 chars)                        -> {ok}
// PATCH /api/me           (auth) {name?, avatar?}                             -> {ok}
// DELETE /api/me          (auth)  leave room                                  -> {ok}
// POST /api/ai/messages (auth) {system?, messages, tools?, tool_choice?, max_tokens?<=1024}
//      -> Anthropic Messages response {id, content:[{type:'text'|'tool_use',...}], stop_reason, usage}
//      Server-side LLM proxy: the provider key/model live ONLY on the server (env WNS_AI_*),
//      never in the app or repo. Per-member rate limit; 429 {error:'ai_rate_limited'}, 503 {error:'ai_unavailable'}.
// GET  /api/ai/status                                                         -> {available:boolean, model:string}
// GET  /healthz                                                               -> "ok"
//
// WS  /ws?room=<code>&token=<token>   server -> client: {type:'room', room, now}
//                                      on connect and after every change (plus every 30s tick).
//                                      client -> server: {type:'ping'}

// ------------------------------------------------------------ derived scene

/** Local hour (0-23.99) for a member given now. */
export function localHour(member, now) {
  const mins = (now / 60000 + (member.tzOffset || 0)) % 1440;
  return ((mins + 1440) % 1440) / 60;
}

export function isNightHour(h) {
  return h >= 0 && h < 6; // "after midnight" window
}

/**
 * Derive what each member is visibly doing. This is THE rule set for the
 * "who's not sleeping" game — renderer, app UI and widgets all use it.
 *
 * pose:
 *   'typing'   at desk, hands on keyboard, monitor shows AI tool animation
 *   'sitting'  at desk, computer on, no AI (sips drink, looks around)
 *   'empty'    computer on but user away — empty chair, screensaver
 *   'sleeping' in bed with Zzz (said goodnight, or offline during night)
 *   'gone'     offline in daytime — desk dark, nobody
 *
 * badge (big emote over head, persistent while condition holds):
 *   'caught'   -> on the night owl: said goodnight but now working after midnight ("!" + sweat)
 *   'question' -> on sleepers while someone else is a night owl (big "?")
 *   null
 *
 * @param {Room} room
 * @param {number} now ms epoch
 */
export function deriveScene(room, now) {
  const members = (room?.members || []).map((m) => {
    const online = now - (m.lastSeen || 0) < OFFLINE_AFTER_MS;
    const status = online ? m.status : 'offline';
    const h = localHour(m, now);
    const night = isNightHour(h);
    const saidGoodnight = !!m.goodnightAt && now - m.goodnightAt < GOODNIGHT_TTL_MS;
    let pose;
    if (status === 'working') pose = 'typing';
    else if (status === 'idle') pose = saidGoodnight ? 'sleeping' : 'sitting';
    else if (status === 'away') pose = saidGoodnight || night ? 'sleeping' : 'empty';
    else pose = saidGoodnight || night ? 'sleeping' : 'gone';
    // night owl: said goodnight, it's now past midnight locally, and they're on the AI again
    const nightOwl = saidGoodnight && status === 'working' && (night || (m.statusSince || 0) > m.goodnightAt);
    return { ...m, status, online, localHour: h, night, saidGoodnight, pose, nightOwl, badge: null };
  });
  const owls = members.filter((m) => m.nightOwl);
  for (const m of members) {
    if (m.nightOwl) m.badge = 'caught';
    else if (owls.length && m.pose === 'sleeping') m.badge = 'question';
  }
  // transient emotes / speech still alive
  for (const m of members) {
    m.activeEmote = m.emote && now - m.emote.at < EMOTE_TTL_MS ? m.emote : null;
    m.activeSay = m.say && now - m.say.at < SAY_TTL_MS ? m.say : null;
  }
  // room-level lighting: average local hour of members (or first member), drives sky/ambient
  const ref = members[0];
  const roomHour = ref ? ref.localHour : new Date(now).getHours();
  const anyoneAwake = members.some((m) => m.pose === 'typing' || m.pose === 'sitting');
  return {
    code: room?.code, name: room?.name,
    members, owls: owls.map((m) => m.id),
    roomHour, // 0..24 drives day/dusk/night palette
    lightsOn: anyoneAwake && !isNightHour(roomHour), // ceiling light off at night: only monitors/lamps/moon glow
  };
}

/** Deterministic avatar from a string (used for defaults). */
export function avatarFromSeed(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  const r = (n) => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return Math.abs(h) % n; };
  return { skin: r(6), hair: r(10), hairStyle: r(6), shirt: r(12), accessory: r(5) };
}

export const AVATAR_COUNTS = { skin: 6, hair: 10, hairStyle: 6, shirt: 12, accessory: 5 };
