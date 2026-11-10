# 公共 API · Public API

Base URL: **`https://wns.168-231-73-244.sslip.io`**

所有请求和响应都是 JSON（`scene.png` 除外）。CORS 全开（`*`），任何网页、脚本、硬件小屏都能直接调。
All bodies are JSON (except `scene.png`). CORS is `*`.

## 认证 · Auth

加入或创建房间会拿到一个成员 `token`。需要身份的接口带上：
Creating/joining a room returns a member `token`. Send it as:

```
Authorization: Bearer <token>
```

token 等于"这个小人的遥控器"，别贴到公开的地方。房间快照里**永远不会**包含 token。
A token is the remote control for one buddy — keep it private. Room snapshots never include tokens.

## 限流 · Limits

| 范围 | 限额 |
|---|---|
| 每个 IP 全部接口 · per IP, all endpoints | 240 次/分钟（突发 120）|
| `POST /api/link` 每个 IP | 10 次/分钟 |
| `POST /api/ai/messages` 每个成员 | 20 次/分钟（突发 10），400 次/天 |
| 请求体 · body | 16 KB（AI 接口 192 KB）|
| 房间人数 · members per room | 6 |

错误统一返回 `{ "error": "..." }`，状态码 400 / 401 / 404 / 405 / 409（房间满）/ 413 / 429 / 500 / 502 / 503 / 504。AI 接口的错误字符串：`ai_unavailable`（503）、`ai_rate_limited`（429）、`ai_upstream_error`（502）、`ai_timeout`（504）。
Errors are `{ "error": "..." }` with 400/401/404/405/409/413/429/500/502/503/504.

---

## 房间 · Rooms

### 创建房间 · Create
`POST /api/rooms`
```json
{ "name": "深夜肝帝", "member": { "name": "小明", "avatar": { "skin": 1, "hair": 2, "hairStyle": 0, "shirt": 4, "accessory": 4 }, "tzOffset": 480 } }
```
→ `201 { room, memberId, token }`

`avatar` 可省略（按名字随机生成）。`tzOffset` = 本地时间比 UTC 早多少分钟（北京时间 480）。
`avatar` is optional. `tzOffset` = minutes east of UTC.

| avatar 字段 | 取值 |
|---|---|
| `skin` | 0–5（浅 → 深）|
| `hair` | 0–9 发色 |
| `hairStyle` | 0–5：`messy` `long` `spiky` `bob` `bun` `buzz` |
| `shirt` | 0–11 衣服颜色 |
| `accessory` | 0–4：`none` `glasses` `headphones` `cap` `catears` |

### 加入 · Join
`POST /api/rooms/:code/join` `{ "member": { "name": "...", "avatar": {...}, "tzOffset": 480 } }` → `{ room, memberId, token }`

### 读房间 · Read (no auth)
`GET /api/rooms/:code` → `{ room }`

```json
{ "room": {
  "code": "ABCDE", "name": "深夜肝帝", "createdAt": 1794270739413,
  "members": [{
    "id": "0c8c6fc7a629", "name": "小明", "seat": 0,
    "avatar": { "skin": 1, "hair": 2, "hairStyle": 3, "shirt": 4, "accessory": 1 },
    "status": "working", "tool": "claude", "detail": "whonotsleep",
    "tzOffset": 480, "lastSeen": 1794270744151, "statusSince": 1794270742575,
    "goodnightAt": null, "emote": null, "say": null, "hasComputer": true
  }],
  "events": [{ "at": 1794270742575, "memberId": "0c8c6fc7a629", "kind": "started", "text": "开始用 Claude Code · whonotsleep" }]
} }
```

`status`: `offline | idle | working | away`。`tool`: `claude codex gemini cursor copilot aider opencode goose amp chatgpt other`。
画面上每个人在干嘛（打字/坐着/离开/睡觉/被抓包）由 [`shared/protocol.js`](../shared/protocol.js) 的 `deriveScene(room, now)` 推导，前端直接 import 它就能得到和 App 一模一样的判定。
What each buddy is visibly doing (typing / sitting / away / sleeping / caught) is derived by `deriveScene(room, now)` in `shared/protocol.js`.

### 像素画面 · Rendered pixel scene (no auth)
`GET /api/rooms/:code/scene.png?layout=room|wide|small&scale=1..6&focus=<memberId>`

| layout | 基础尺寸 |
|---|---|
| `room` | 192×120 |
| `wide` | 192×88 |
| `small` | 96×96（以 `focus` 成员为中心）|

`scale` 是整数放大倍数（最近邻，像素不糊），默认 4。缓存 10 秒。拿来做网页挂件、墨水屏、Stream Deck 都行：
Integer nearest-neighbour upscale (default 4), cached 10 s. Great for web embeds, e-ink, Stream Deck:

```html
<img src="https://wns.168-231-73-244.sslip.io/api/rooms/ABCDE/scene.png?layout=wide&scale=3" style="image-rendering:pixelated">
```

### 实时推送 · Live updates
`WS wss://wns.168-231-73-244.sslip.io/ws?room=<code>&token=<token>`

服务器 → 客户端：连上时、每次变化、每 30 秒各推一次 `{ "type": "room", "room": {...}, "now": 1794270744151 }`。客户端可发 `{ "type": "ping" }` 保活。
Server pushes `{type:'room', room, now}` on connect, on every change, and every 30 s.

---

## 我的小人 · Me (auth)

| 接口 | 请求体 | 说明 |
|---|---|---|
| `POST /api/me/report` | `{ status, tool, detail, tzOffset }` | 上报状态（电脑端每 20 秒心跳）。90 秒没心跳算离线 |
| `POST /api/me/goodnight` | – | 说晚安。之后过了 12 点又开 AI → 被抓包 |
| `POST /api/me/morning` | – | 说早安（清除晚安）|
| `POST /api/me/emote` | `{ kind, to? }` | `question exclaim zzz heart note sweat star wave angry moon`；`to` = 对方 memberId |
| `POST /api/me/say` | `{ text }` | 对话泡，≤ 80 字，显示 9 秒 |
| `PATCH /api/me` | `{ name?, avatar? }` | 改名 / 换造型（avatar 可只传部分字段）|
| `DELETE /api/me` | – | 离开房间（最后一人离开房间即删除）|
| `POST /api/me/linkcode` | – | 生成电脑配对码 `{ linkCode, expiresAt }`（6 位，10 分钟，一次性）|

### 电脑配对 · Link a computer
`POST /api/link` `{ "linkCode": "ABC234" }` → `{ token, memberId, roomCode, name }`

### 例子 · Example: 用 curl 做个自己的上报器

```bash
S=https://wns.168-231-73-244.sslip.io
T=你的token
curl -X POST $S/api/me/report -H "authorization: Bearer $T" -H 'content-type: application/json' \
  -d '{"status":"working","tool":"codex","detail":"my-repo","tzOffset":480}'
curl -X POST $S/api/me/goodnight -H "authorization: Bearer $T"
```

---

## AI 接口 · AI proxy (auth)

App 里的「AI 助手」和「AI 叽里呱啦」都走这个接口。**模型的 API Key 只存在服务器上**，客户端和仓库里都没有；只有房间成员（带 token）能调用。
The in-app AI assistant uses this. The provider key lives only on the server; only room members can call it.

`GET /api/ai/status` → `{ "available": true, "model": "glm-5.3-flash" }`（未配置时 `{ "available": false, "model": null }`）

`POST /api/ai/messages` — Anthropic Messages 格式（支持 tools）：

```json
{
  "system": "你是像素房间管家",
  "messages": [{ "role": "user", "content": "帮我换成猫耳朵" }],
  "tools": [{ "name": "update_avatar", "description": "修改小人造型",
              "input_schema": { "type": "object", "properties": { "accessory": { "type": "string", "enum": ["none","glasses","headphones","cap","catears"] } } } }],
  "max_tokens": 300
}
```
→
```json
{ "content": [{ "type": "tool_use", "id": "call_…", "name": "update_avatar", "input": { "accessory": "catears" } }],
  "stop_reason": "tool_use" }
```

模型由服务器决定（客户端传的 `model` 会被忽略），`max_tokens` 上限 1024，最多 60 条消息、32 个工具。
The server picks the model (client `model` is ignored); `max_tokens` ≤ 1024; ≤ 60 messages, ≤ 32 tools.

---

## 其它 · Misc
`GET /healthz` → `ok`

## 自己部署 · Self-host

需要克隆整个仓库（服务器会 import `shared/` 里的协议和渲染器）。

```bash
git clone https://github.com/Shiyao-Huang/whonotsleep && cd whonotsleep/server && npm ci
# 可选：开启 AI 接口（任何 Anthropic 兼容的服务都行）——先设环境变量再启动
export WNS_AI_BASE_URL=https://api.anthropic.com   # 或其它兼容端点
export WNS_AI_KEY=...                               # 只放在服务器环境变量里，别提交到仓库
export WNS_AI_MODEL=claude-haiku-5-5
PORT=3420 node index.js
```
参考 [`server/whonotsleep.service`](../server/whonotsleep.service)（systemd，从 `/etc/whonotsleep.env` 读取 key）和 [`server/.env.example`](../server/.env.example)。
