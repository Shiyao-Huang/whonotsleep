# WhoNotSleep (谁还没睡) — Design

When you start any AI tool on your computer (Claude Code, Codex, Gemini CLI, Cursor, Aider, ChatGPT app...), your 8-bit pixel buddy sits down at their desk in a shared pixel room on your friends' phones (app + iOS/Android home-screen widgets). The monitor lights up with the AI tool's color and a little AI sprite bounces on the screen. If you said goodnight and then sneak back to the AI after midnight, you get caught: a sweating "!" over your head, and big "?" over every sleeping friend's head.

## Repo layout (module ownership)

```
shared/protocol.js   contract: types, API list, deriveScene() rules        (owner: lead — read only for others)
shared/scene.js      pure-JS 8-bit renderer with per-pixel lighting        (owner: renderer)
shared/png.js        PNG encoder (deflate injected) + base64               (owner: renderer)
shared/preview.mjs   node script: renders sample scenes to shared/previews/*.png (owner: renderer)
server/              Node 20 + `ws`; REST + WebSocket + scene.png           (owner: server)
cli/                 Mac CLI `wns` (zero deps, Node>=18); root package.json bin -> cli/bin/wns.js (owner: cli)
app/                 Expo SDK 58 / React Native 0.88 app                    (owner: app)
app/src/widgets/android/*   Android widget (react-native-android-widget)    (owner: android-widget)
app/src/widgets/ios/*       JS side of iOS widget sync                       (owner: ios-widget)
app/targets/widget/*        Swift WidgetKit target (@bacons/apple-targets)   (owner: ios-widget)
```
`app/app.json`, `app/index.ts`, `app/metro.config.js`, root `package.json`, `shared/protocol.js` are owned by the lead — if you need a change there, describe it in your final report instead of editing.

## Server
Public URL: `https://wns.168-231-73-244.sslip.io` (Caddy TLS on the deploy host → `127.0.0.1:3420`). API in `shared/protocol.js`. Rooms identified by a 5-char code (A-Z, 2-9, no ambiguous chars). Tokens are random 32-byte hex, stored hashed is NOT needed (keep it simple, store as is) — JSON file persistence in `server/data/rooms.json`, written debounced.

## Renderer API (`shared/scene.js`)
```js
export const LAYOUTS = { room: {w:192,h:120}, wide: {w:192,h:88}, small: {w:96,h:96} };
// derived = deriveScene(room, now) from protocol.js
// t = animation time in ms (drives typing, blinking, particles, bobbing)
// focusId = member to center on (small layout shows that member's desk zoomed / cropped)
export function renderScene(derived, { layout='room', t=0, focusId=null }) -> { width, height, data: Uint8ClampedArray /*RGBA*/ }
export function renderAvatar(avatar, { t=0, size=32 }) -> { width, height, data }   // portrait for avatar picker
export function avatarPalette(avatar) -> { skin, hair, shirt, ... }  // CSS hex strings for UI chips
```
`shared/png.js`:
```js
export function encodePNG(width, height, rgba, { scale=1, deflate }) -> Uint8Array  // nearest-neighbour integer upscale; deflate(Uint8Array)->Uint8Array injected (pako.deflate in RN, zlib.deflateSync in node)
export function bytesToBase64(bytes) -> string
```
Must be deterministic, dependency-free, work in Hermes (no Buffer, no TextEncoder assumptions), and render a `room` frame in < 25 ms on a phone (avoid per-pixel object allocation; use typed arrays, precomputed light maps).

## Art direction — "8-bit, super delicate, with light rendering"
- Low-res pixel canvas (192×120 base), displayed with nearest-neighbour scaling. Limited curated palette (~48 colors, think late-night lo-fi room: indigo/navy shadows, warm amber lamps, coral/mint/violet monitor glows). Final colors quantized back to the palette with 4×4 Bayer dithering on light gradients so light falloff looks like hand-dithered pixel art, not smooth blur.
- Lighting model per pixel: `color = albedo * (ambient(timeOfDay) + Σ lights) + emissive`, lights = monitor glow (cone in front of screen, tinted by TOOLS[tool].color, flickers subtly with typing), desk lamps, ceiling light (when `lightsOn`), moonlight / sunlight shaft through the window (angle + color from `roomHour`: dawn pink, day warm white, dusk orange, night blue moon). Soft bloom halo around emissive pixels (screen, lamp bulb, stars). Characters get rim light from their monitor.
- Room: back wall with window (sky gradient + stars/moon/clouds by hour, city skyline silhouettes with lit windows at night), posters, shelf with plants, a wall clock showing roomHour, floor boards. Up to 6 desks in a row/arc, each with chair, monitor, keyboard, mug, small lamp; a cozy bed/futon area on one side where sleepers lie (one bed slot per member, stacked/bunk if needed).
- Character: ~12×18 px chibi; avatar maps to skin/hair color/hair style/shirt/accessory (glasses, headphones, cap, cat ears, none). Name tag under desk (tiny 3×5 pixel font, ASCII only; non-ASCII names → initials/first ASCII chars or a colored dot).
- Poses (from deriveScene): `typing` (2–3 frame typing loop, head bob, screen shows scrolling code lines + the AI sprite: a little glowing blob/robot in the tool color that hops/blinks on screen), `sitting` (leans back, sips mug, steam pixels), `empty` (chair pushed back, screensaver bouncing on monitor), `sleeping` (in bed under blanket, breathing rise/fall, floating Zzz), `gone` (desk dark, monitor off).
- Badges: `caught` → big red "!" + sweat drops, bounces; `question` → big bobbing "?" bubble over the sleeper (this is the core joke). Transient `activeEmote` bubble (heart, note, wave, star, zzz, angry, moon, question, exclaim, sweat) and `activeSay` speech bubble (render text only if ASCII, else a "..." squiggle bubble — the app overlays real text).
- Ambient life: dust motes in light shafts, blinking cursor, flickering stars, occasional cat walking across the floor at night, steam from mugs.

## App UX (Expo, dark pixel aesthetic)
Screens: Onboarding (name + avatar picker with live pixel portrait) → Create room / Join by code → Room (full-width live animated scene drawn with Skia at 12–15 fps, tap a character to emote at them; below: member list with status chip "Claude Code · whonotsleep · 23m", activity feed; bottom action bar: 🌙 晚安 / ☀️ 早安 / emote picker / say) → Link computer (shows 6-char link code + copyable command `npx -y github:Shiyao-Huang/whonotsleep link ABC123`) → Settings (server URL, AI: Anthropic API key in SecureStore + model `claude-haiku-5-5` + toggle "AI 叽里呱啦" which periodically generates a short cute in-character line for your buddy based on room state and posts it via /api/me/say; leave/rename).
Session persisted in AsyncStorage key `wns:session` = `{serverUrl, roomCode, token, memberId}`. Text overlays (names, speech in Chinese) are drawn by RN/Skia on top of the pixel canvas at mapped coordinates — renderer exports `memberAnchors(derived, layout)` → `[{id, x, y}]` head positions in base pixels for overlay placement.

## Widgets
- `syncWidgets(session, room)` in `app/src/widgets/index.ts` (app owner) dispatches to `syncAndroidWidgets` (`src/widgets/android/sync.ts`) and `syncIOSWidgets` (`src/widgets/ios/sync.ts`). Called whenever the room changes while app is running.
- Android: `RoomWidget` (4×2, room/wide layout) and `MeWidget` (2×2, small layout focused on me). Rendered in the headless task: read `wns:session` from AsyncStorage, fetch room JSON, `deriveScene` → `renderScene` → `encodePNG(scale, pako.deflate)` → `data:image/png;base64` into ImageWidget. Keep encoded PNG well under 500 KB (RemoteViews IPC limit). Click actions: open app; "晚安" button → POST goodnight then re-render.
- iOS: WidgetKit target `targets/widget` (Swift). Reads App Group `group.com.copizza.whonotsleep` UserDefaults keys `serverUrl`, `roomCode`, `memberId`, `token` (written by app through `ExtensionStorage` from `@bacons/apple-targets`). Timeline fetches `GET {serverUrl}/api/rooms/{code}/scene.png?layout=small|wide|room&scale=4&focus={memberId}` and shows it with `.interpolation(.none)`; refresh policy every ~10 min, plus app calls `ExtensionStorage.reloadWidget()` on changes. Families: systemSmall (me), systemMedium (wide), systemLarge (room). Interactive "晚安" button (AppIntent, iOS 17+) POSTs goodnight with the token.
