# wns — 谁还没睡 (WhoNotSleep) Mac CLI

你一打开 AI 工具（Claude Code、Codex、Gemini CLI、Cursor、Aider、ChatGPT…），朋友手机上的 8-bit 像素小人就会坐到电脑前，显示器亮起那个 AI 的颜色。说了晚安又偷偷回来肝？头上冒汗加个大大的 **!**，睡着的朋友头上全是 **?**。

When you start any AI tool on your Mac, your pixel buddy sits down at their desk in a shared pixel room on your friends' phones. Say goodnight and sneak back after midnight — you get caught.

零依赖 · zero dependencies · Node ≥ 18 · macOS

## 安装 · Install

```sh
# 一次性运行 · one-off (no install)
npx -y github:Shiyao-Huang/whonotsleep link ABC123

# 或全局安装 · or install globally (recommended for the background agent)
npm i -g github:Shiyao-Huang/whonotsleep
wns link ABC123        # 6 位码来自 App → 连接电脑 · code from the app's "Link computer" screen
wns install            # 开机自启后台守护 · background LaunchAgent (RunAtLoad + KeepAlive)
wns hook install       # 可选: Claude Code 钩子，状态秒变 · optional: instant presence via Claude Code hooks
```

## 命令 · Commands

| 命令 Command | 说明 Description |
|---|---|
| `wns link <CODE> [--server URL]` | 用 App 给的码连接，配置存到 `~/.config/whonotsleep/config.json` (600) · link this Mac |
| `wns install` / `wns uninstall` | 安装/移除 launchd 后台守护 `~/Library/LaunchAgents/com.whonotsleep.agent.plist`，日志 `~/Library/Logs/whonotsleep.log` |
| `wns start` | 前台运行守护循环（`--verbose` 打印每次心跳）· foreground daemon loop |
| `wns status` | 配置、守护是否在跑、当前检测结果、房间里所有人 · everything at a glance |
| `wns room` | 房间成员 + 最近动态 · members and recent events |
| `wns gn` / `wns goodnight` | 说晚安 ☾ |
| `wns morning` | 说早安 ☀ |
| `wns say <text>` | 冒个泡（≤80 字）· speech bubble |
| `wns emote <kind> [@name]` | `question exclaim zzz heart note sweat star wave angry moon` |
| `wns ping [--quiet]` | 立刻检测并上报一次 · single immediate report |
| `wns hook install` / `uninstall` | 在 `~/.claude/settings.json` 的 `UserPromptSubmit` 和 `Stop` 里加/删 `wns ping --quiet --detach`（后台上报，不拖慢提问；先备份，非破坏性合并）|
| `wns logout` | 删除本地配置 · forget this room |
| `wns detect [--json]` | 调试：只看检测结果 · debug detection only |
| `wns help` | 帮助 |

## 检测规则 · How detection works

- 每 15 秒跑 `ps`，识别 AI 工具进程：`claude`（CLI / Claude 桌面版里的 Claude Code / VS Code 扩展）、`codex`、`gemini`、`cursor-agent`、`copilot`、`aider`、`opencode`、`goose`、`amp`，以及桌面 App（Claude.app、ChatGPT.app、Cursor.app…）。Electron Helper / Renderer / crashpad、`grep claude`、VS Code 扩展宿主等误报会被排除。
- 多个工具同时运行时取**最近启动的 CLI 工具**；只有没有 CLI 时才算桌面 App。
- `detail` = 该进程工作目录的文件夹名（如 `whonotsleep`），可用 `"shareDetail": false` 关闭。
- 键鼠空闲 > 5 分钟 (`ioreg HIDIdleTime`) → `away`（椅子空着）。
- 状态变化立即上报，否则每 20 秒心跳；网络错误指数退避，永不崩溃。

Every 15 s `ps` is scanned for AI tools (newest CLI tool wins; desktop apps only count when no CLI runs). `detail` is the tool's working-directory name. HID idle > 5 min → `away`. Reports on change, heartbeat every 20 s, exponential backoff on errors.

### 配置 · Config (`~/.config/whonotsleep/config.json`)

```json
{
  "serverUrl": "https://wns.168-231-73-244.sslip.io",
  "token": "…", "memberId": "…", "roomCode": "ABCDE", "name": "you",
  "shareDetail": true,
  "countApps": true,
  "awayAfterMinutes": 5,
  "extraTools": { "kimi": "kimi-cli", "crush": "(^|/)crush$" }
}
```

`extraTools`: name → regex (matched against the command line). Unknown names show as generic "AI".
Env: `WNS_SERVER` (server for `link`), `WNS_CONFIG_DIR`, `NO_COLOR`.

## 开发 · Dev

```sh
node --test cli/test.mjs
node cli/bin/wns.js detect
```
