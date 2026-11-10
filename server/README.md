# WhoNotSleep server (谁还没睡)

Node 20 ESM, single dependency `ws`. Implements the REST + WebSocket API defined in
`../shared/protocol.js` and renders `scene.png` with `../shared/scene.js` + `../shared/png.js`.

```
npm install
npm start          # PORT=3420 HOST=127.0.0.1 DATA_FILE=./data/rooms.json
npm test           # node --test test.mjs (boots in-process on a random port)
./deploy.sh        # rsync server/ + shared/ to $WNS_DEPLOY_HOST:/opt/whonotsleep, npm ci, restart systemd unit
```

Env: `PORT` (3420), `HOST` (127.0.0.1), `DATA_FILE` (`server/data/rooms.json`),
`TRUST_PROXY` (default on: `X-Forwarded-For` is honoured only when the peer is loopback, i.e. Caddy; the rightmost entry is used).

## Layout
- `index.js` — entry: env, listen, SIGINT/SIGTERM flush.
- `app.js` — `createApp({dataFile, tickMs, now, rateLimit, linkRateLimit, loadRenderer, ...})` → `{server, listen, close, tick, store}`.
- `whonotsleep.service` — systemd unit (WorkingDirectory `/opt/whonotsleep/server`).
- `deploy.sh` — not run automatically.

## Behaviour notes
- Errors: `{error}` with 400 (validation / bad JSON), 401 (missing/invalid Bearer token), 404 (room / link code / route),
  405, 409 (room full, `MAX_MEMBERS`), 413 (body > 16 KB), 429 (rate limit), 503 (renderer not available).
- `POST /api/rooms` returns **201**; everything else 200. CORS `*` on all responses, `OPTIONS` → 204.
- Rate limit: per-IP token bucket, 240/min (burst 120) overall; `/api/link` additionally 10/min per IP.
- Room codes: 5 chars, link codes: 6 chars, alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789`. Link codes expire after
  10 min, are single use, and issuing a new one invalidates the member's previous code. `/api/link` returns the
  member's existing token (one token per member, shared by app and CLI) and sets `hasComputer=true`.
- Seats: lowest free seat 0..5. Empty rooms are deleted when the last member leaves.
- Heartbeat timeout: on the 30 s tick (and on reads) a member with `lastSeen` older than `OFFLINE_AFTER_MS` is set to
  `status:'offline'`, `tool:null`, `statusSince = lastSeen + OFFLINE_AFTER_MS` (emits `stopped` if they were working).
- Report: unknown `tool` while `working` → `'other'`; `tool`/`detail` are nulled when not working; `detail` ≤ 40 chars.
  `statusSince` changes only when status or tool changes.
- Emote: `to` places the emote on the target member with `from = sender`; without `to`, on self with `from = null`.
- Say: 1–80 characters (code points), control chars stripped.
- Events (`room.events`, newest last, max 50) — `kind` / `text` (text omits the subject; look up `memberId`):
  `joined` 创建了房间 / 加入了房间, `left` 离开了房间, `started` 开始用 Claude Code · detail,
  `stopped` 停下了 Claude Code, `goodnight` 说了晚安, `morning` 说了早安,
  `caught-night-owl` 说了晚安却还在用 Claude Code,被抓到了! (once per nightOwl episode, per `deriveScene`),
  `emote` `heart` or `heart → Bob`, `say` the text.
- WebSocket `/ws?room=CODE&token=TOKEN` (HTTP 401/404 on bad upgrade): `{type:'room', room, now}` on connect, after every
  change and every 30 s; client `{type:'ping'}` → `{type:'pong', now}`. Dead sockets are dropped via ws ping/pong.
- Tokens never appear in room snapshots or WS messages (they are only in `data/rooms.json`).
- `scene.png?layout=room|wide|small&scale=1..6(default 4, clamped)&focus=<memberId>&t=<ms>`: cached per
  (room version, layout, scale, focus, 10 s bucket[, explicit t]); `Cache-Control: public, max-age=10`.
  Without `t`, the animation time is the start of the 10 s bucket.
- Persistence: `data/rooms.json` written debounced (1 s) via tmp+rename (mode 0600), flushed on shutdown. An unparseable file is renamed to `rooms.json.corrupt-<ts>` instead of being overwritten.

- `PATCH /api/me` with a partial `avatar` merges into the current avatar.

## AI proxy

- `GET /api/ai/status` → `{available, model}` (`model` is `null` when unconfigured).
- `POST /api/ai/messages` (Bearer token) — Anthropic Messages format with tools. The server forces its own model, disables thinking, caps `max_tokens` at 1024, ≤ 60 messages, ≤ 32 tools, body ≤ 192 KB.
- Limits: 20/min per member (burst 10), 400/day per member. Errors: 503 `ai_unavailable`, 429 `ai_rate_limited`, 502 `ai_upstream_error`, 504 `ai_timeout`.
- Config via env only: `WNS_AI_BASE_URL`, `WNS_AI_KEY`, `WNS_AI_MODEL` — systemd loads them from `/etc/whonotsleep.env` (`EnvironmentFile=`, chmod 600). Never commit the key; see `.env.example`.
- `createApp({ ..., ai, aiFetch, aiRateLimit })` for tests.
